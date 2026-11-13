import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SafeFs } from '../repository/safe-fs'
import { listHrRequests, parseHrRequest, setHrRequestStatus } from './hr-request'

const doc = (status = 'pending', who = 'coo', body = '개발자 한 명을 채용해 주세요.'): string =>
  `# 인사 요청 001\n\n- **지시자:** ${who}\n- **상태:** ${status}\n\n## 요청\n${body}\n`

describe('hr request parser', () => {
  it('reads a well-formed request', () => {
    expect(parseHrRequest('001.md', doc())).toEqual({
      id: '001',
      requester: 'coo',
      status: 'pending',
      body: '개발자 한 명을 채용해 주세요.'
    })
    expect(parseHrRequest('012.md', doc('done', 'ceo-via-coo'))?.requester).toBe('ceo-via-coo')
  })

  it.each([
    ['bad name', '1.md', doc()],
    ['name with slug', '001-x.md', doc()],
    ['unknown requester', '001.md', doc('pending', 'hr')],
    ['unknown status', '001.md', doc('approved')],
    ['empty body', '001.md', doc('pending', 'coo', '  ')],
    ['oversized body', '001.md', doc('pending', 'coo', 'a'.repeat(9000))],
    ['no request section', '001.md', '- **지시자:** coo\n- **상태:** pending\n']
  ])('rejects %s', (_n, name, text) => {
    expect(parseHrRequest(name, text)).toBeNull()
  })
})

describe('hr request files', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
  })
  const open = async (): Promise<SafeFs> => {
    const d = await mkdtemp(join(tmpdir(), 'mc-hrreq-'))
    dirs.push(d)
    return SafeFs.open(d)
  }

  it('lists valid requests in order, counts invalid ones, and tolerates a missing folder', async () => {
    const fs = await open()
    expect(await listHrRequests(fs)).toEqual({ items: [], invalid: 0 })
    await fs.writeText('company/hr-requests/010.md', doc())
    await fs.writeText('company/hr-requests/002.md', doc('done'))
    await fs.writeText('company/hr-requests/junk.md', 'x')
    const r = await listHrRequests(fs)
    expect(r.items.map((i) => i.id)).toEqual(['002', '010'])
    expect(r.invalid).toBe(1)
  })

  it('changes only the status line and appends an app-written result', async () => {
    const fs = await open()
    await fs.writeText('company/hr-requests/001.md', doc())
    await setHrRequestStatus(fs, '001', 'running')
    await setHrRequestStatus(fs, '001', 'done', '제안 카드 D-001\n<script>')
    const text = await fs.readText('company/hr-requests/001.md')
    expect(text).toContain('- **상태:** done')
    expect(text).toContain('## 처리 결과\n- 제안 카드 D-001 <script>')
    expect(parseHrRequest('001.md', text)?.body).toBe('개발자 한 명을 채용해 주세요.')
    await expect(setHrRequestStatus(fs, '../x', 'done')).rejects.toThrow()
  })
})
