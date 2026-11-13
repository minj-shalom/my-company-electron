import { createHash } from 'node:crypto'
import type { Publisher, PublishOutcome } from '../gate/publisher'
import type { GatePublishErrorCode, PublishErrorCode, VerifiedMedia } from '../../shared/publisher'
import type { CredentialService } from '../credentials/credential-service'
import type { AdapterRegistry } from './adapter-registry'
import { verifyMedia } from './media-verifier'
import { createMemoryRecordStore, type PublishRecordStore } from './publish-records'

export interface DraftSource {
  /** 발행 시점에 초안 파일을 main이 다시 읽는다. 읽지 못하면 null. */
  read(projectId: string, draftPath: string): Promise<string | null>
  /** 미디어 경로의 기준이 되는 산출물 폴더. 미디어를 쓰지 않으면 생략한다. */
  outputRoot?(projectId: string): Promise<string | null>
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

function titleOf(body: string, fallback: string): string {
  const m = /^#\s+(.+)$/m.exec(body)
  return (m?.[1] ?? fallback).trim().slice(0, 200)
}

export const GATE_CODE: Record<PublishErrorCode, GatePublishErrorCode> = {
  'hash-mismatch': 'rejected',
  'not-connected': 'auth',
  rejected: 'rejected',
  network: 'network',
  auth: 'auth',
  quota: 'quota',
  'needs-review': 'needs-review',
  'media-invalid': 'media-invalid',
  pending: 'pending',
  unknown: 'unknown'
}

/** 성공 외에, 서버에 게시됐을 수 있어 사람이 확인해야 하는 결과. 나머지 실패는 확정이라 재시도해도 중복이 없다. */
const AMBIGUOUS: ReadonlySet<PublishErrorCode> = new Set(['network', 'pending', 'unknown'])

/**
 * T-050 게이트의 `Publisher` 호출 자리와 어댑터 계약을 잇는다.
 * 발행 시점에 초안을 다시 읽어 해시가 승인된 `draftHash`와 같을 때만 어댑터를 부른다 (T-050 검수 요구).
 * 어댑터 예외는 내용을 버리고 `unknown`으로 바꾼다.
 */
export function createGatePublishers(deps: {
  registry: AdapterRegistry
  credentials: CredentialService
  drafts: DraftSource
  /** 멱등 키 기록. 생략하면 메모리 기록(앱 재시작 시 사라짐)을 쓴다. */
  records?: PublishRecordStore
}): Map<string, Publisher> {
  const records = deps.records ?? createMemoryRecordStore()
  const out = new Map<string, Publisher>()
  for (const adapter of deps.registry.list()) {
    if (!adapter.usesCredentials) continue
    out.set(adapter.id, {
      id: adapter.id,
      publish: async (req, signal): Promise<PublishOutcome> => {
        const body = await deps.drafts.read(req.projectId, req.draftPath).catch(() => null)
        if (body === null || sha256(body) !== req.draftHash)
          return { ok: false, code: GATE_CODE['hash-mismatch'] }
        let media: VerifiedMedia[] | undefined
        if (req.media !== undefined && req.media.length > 0) {
          const root = await deps.drafts.outputRoot?.(req.projectId).catch(() => null)
          if (root === null || root === undefined) return { ok: false, code: 'media-invalid' }
          const v = await verifyMedia(root, req.media)
          if (!v.ok) return { ok: false, code: GATE_CODE[v.code] }
          media = v.media
        }

        // 같은 멱등 키는 한 번만 어댑터에 간다. 결과를 모르는 키는 사람이 확인하기 전까지 다시 보내지 않는다.
        const key = sha256(`${adapter.id}|${req.idempotencyKey}`)
        if (!(await records.begin(key))) {
          return records.get(key) === 'published'
            ? { ok: true }
            : { ok: false, code: 'confirm-required' }
        }
        try {
          const r = await adapter.publish(
            {
              projectId: req.projectId,
              draftPath: req.draftPath,
              contentHash: req.draftHash,
              title: titleOf(body, req.draftPath),
              body,
              idempotencyKey: req.idempotencyKey,
              ...(media === undefined ? {} : { media })
            },
            deps.credentials.contextFor(adapter.id, signal),
            { signal }
          )
          if (r.ok) {
            // dryRun은 게시하지 않았으므로 기록을 남기지 않는다.
            if (r.dryRun === true) await records.clear(key)
            else await records.set(key, 'published')
            return { ok: true }
          }
          if (AMBIGUOUS.has(r.code)) {
            await records.set(key, 'needs-confirm')
            return { ok: false, code: r.code === 'pending' ? 'pending' : 'confirm-required' }
          }
          await records.clear(key)
          return { ok: false, code: GATE_CODE[r.code] }
        } catch {
          // 어댑터가 던졌거나 중단됐다면 서버에 게시됐을 수 있다.
          await records.set(key, 'needs-confirm').catch(() => undefined)
          return { ok: false, code: 'confirm-required' }
        }
      }
    })
  }
  return out
}
