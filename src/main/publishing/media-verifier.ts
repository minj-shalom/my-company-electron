import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { MediaKind, PublisherMedia, VerifiedMedia } from '../../shared/publisher'
import { MEDIA_KINDS } from '../../shared/publisher'

export const MAX_MEDIA_COUNT = 10
export const MEDIA_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/
const HASH = /^[0-9a-f]{64}$/

interface Format {
  kind: MediaKind
  mime: string
  maxBytes: number
  /** 파일 앞부분이 형식과 맞는지. 확장자만 믿지 않는다. */
  magic(head: Buffer): boolean
}

const MB = 1024 * 1024
const ascii = (b: Buffer, from: number, text: string): boolean =>
  b.length >= from + text.length && b.toString('latin1', from, from + text.length) === text

const FORMATS: Record<string, Format> = {
  png: {
    kind: 'image',
    mime: 'image/png',
    maxBytes: 20 * MB,
    magic: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  },
  jpg: {
    kind: 'image',
    mime: 'image/jpeg',
    maxBytes: 20 * MB,
    magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  },
  webp: {
    kind: 'image',
    mime: 'image/webp',
    maxBytes: 20 * MB,
    magic: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')
  },
  mp4: {
    kind: 'video',
    mime: 'video/mp4',
    maxBytes: 512 * MB,
    magic: (b) => ascii(b, 4, 'ftyp')
  },
  mov: {
    kind: 'video',
    mime: 'video/quicktime',
    maxBytes: 512 * MB,
    magic: (b) => ascii(b, 4, 'ftyp')
  },
  webm: {
    kind: 'video',
    mime: 'video/webm',
    maxBytes: 512 * MB,
    magic: (b) => b.length >= 4 && b.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))
  }
}
FORMATS.jpeg = FORMATS.jpg

export type MediaVerifyResult =
  { ok: true; media: VerifiedMedia[] } | { ok: false; code: 'media-invalid' | 'hash-mismatch' }

const inside = (root: string, p: string): boolean => {
  const r = relative(root, p)
  return r !== '' && !r.startsWith('..') && !isAbsolute(r)
}

function sha256File(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(abs)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

async function readHead(abs: string): Promise<Buffer> {
  const fh = await open(abs, 'r')
  try {
    const buf = Buffer.alloc(16)
    const { bytesRead } = await fh.read(buf, 0, 16, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/**
 * 발행 직전에 미디어 파일을 검증한다 (텍스트 초안과 같은 원칙: 승인 때의 해시와 지금 파일이 같아야 한다).
 * 경로 탈출과 심볼릭 링크(중간 폴더 포함), 확장자와 종류 불일치, MIME 매직 바이트 불일치, 크기 초과를 거부한다.
 * 어떤 실패도 경로·원문 오류를 담지 않고 닫힌 코드로만 돌려준다. 검증과 어댑터의 읽기 사이 교체 위험은 남으므로
 * 어댑터는 업로드 중 크기가 달라지면 중단해야 한다.
 */
export async function verifyMedia(
  outputRoot: string,
  items: readonly PublisherMedia[]
): Promise<MediaVerifyResult> {
  if (items.length > MAX_MEDIA_COUNT) return { ok: false, code: 'media-invalid' }
  const out: VerifiedMedia[] = []
  try {
    const root = await realpath(outputRoot)
    for (const m of items) {
      if (
        !MEDIA_KINDS.includes(m.kind) ||
        !MEDIA_PATH.test(m.path) ||
        m.path.includes('..') ||
        m.path.includes('//') ||
        m.path.endsWith('/') ||
        !HASH.test(m.contentHash)
      )
        return { ok: false, code: 'media-invalid' }
      const ext = m.path.slice(m.path.lastIndexOf('.') + 1).toLowerCase()
      const fmt = m.path.includes('.') ? FORMATS[ext] : undefined
      if (fmt === undefined || fmt.kind !== m.kind) return { ok: false, code: 'media-invalid' }

      // 경로의 모든 단계가 심볼릭 링크가 아니어야 한다.
      let cur = root
      for (const part of m.path.split('/')) {
        cur = join(cur, part)
        if ((await lstat(cur)).isSymbolicLink()) return { ok: false, code: 'media-invalid' }
      }
      const abs = await realpath(cur)
      if (!inside(root, abs) || abs.split(sep).includes('..'))
        return { ok: false, code: 'media-invalid' }
      const st = await lstat(abs)
      if (!st.isFile() || st.size === 0 || st.size > fmt.maxBytes)
        return { ok: false, code: 'media-invalid' }
      if (!fmt.magic(await readHead(abs))) return { ok: false, code: 'media-invalid' }
      if ((await sha256File(abs)) !== m.contentHash) return { ok: false, code: 'hash-mismatch' }
      out.push({ ...m, mime: fmt.mime, size: st.size, absPath: abs })
    }
  } catch {
    return { ok: false, code: 'media-invalid' }
  }
  return { ok: true, media: out }
}
