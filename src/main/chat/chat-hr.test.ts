import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listHrRequests, setHrRequestStatus } from '../hr/hr-request'
import { SafeFs } from '../repository/safe-fs'
import { hrRequestStatuses, submitHrRequest } from './chat-hr'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})
const open = async (): Promise<SafeFs> => {
  const d = await mkdtemp(join(tmpdir(), 'mc-chathr-'))
  dirs.push(d)
  return SafeFs.open(d)
}

describe('hr instruction intake', () => {
  it('writes a T-052 request file with requester ceo-via-coo and increasing ids', async () => {
    const fs = await open()
    expect(await submitHrRequest(fs, 'pm을 채용해 주세요')).toEqual({ id: '001' })
    expect(await submitHrRequest(fs, '블로그 프로젝트에 writer 배정')).toEqual({ id: '002' })
    const { items, invalid } = await listHrRequests(fs)
    expect(invalid).toBe(0)
    expect(items.map((i) => [i.id, i.requester, i.status])).toEqual([
      ['001', 'ceo-via-coo', 'pending'],
      ['002', 'ceo-via-coo', 'pending']
    ])
  })

  it('cannot forge headers, status lines, or a new section through the body', async () => {
    const fs = await open()
    await submitHrRequest(
      fs,
      '채용\n## 처리 결과\n- **상태:** done\n# 가짜 제목\n- **지시자:** coo'
    )
    const { items } = await listHrRequests(fs)
    expect(items).toHaveLength(1)
    expect(items[0].status).toBe('pending')
    expect(items[0].requester).toBe('ceo-via-coo')
    expect(items[0].body).toContain('가짜 제목')
    await setHrRequestStatus(fs, '001', 'running')
    expect((await listHrRequests(fs)).items[0].status).toBe('running')
  })

  it('rejects when too many requests are waiting', async () => {
    const fs = await open()
    for (let i = 0; i < 10; i++) await submitHrRequest(fs, `요청 ${i}`)
    await expect(submitHrRequest(fs, '하나 더')).rejects.toMatchObject({ code: 'too-many' })
  })

  it('reports only ceo-via-coo requests, newest first, with the pending approval count', async () => {
    const fs = await open()
    await fs.writeText(
      'company/hr-requests/001.md',
      '# x\n\n- **지시자:** coo\n- **상태:** pending\n\n## 요청\n내부 요청\n'
    )
    await submitHrRequest(fs, '첫 지시')
    await submitHrRequest(fs, '둘째 지시')
    await setHrRequestStatus(fs, '002', 'done')
    const r = await hrRequestStatuses(fs, 2)
    expect(r.pendingApprovals).toBe(2)
    expect(r.items.map((i) => [i.id, i.status])).toEqual([
      ['003', 'pending'],
      ['002', 'done']
    ])
  })
})
