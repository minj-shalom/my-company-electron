import { rm } from 'node:fs/promises'
import { makeCompany, put, type TestCompany } from '../employee/test-company'

export { put }
export const PROJECT_MD = `# 프로젝트

## 프로젝트: Alpha
- id: alpha
- 유형: development
- 경로: ../alpha
- PM: pm
- 직원: developer, ui-dev

## 프로젝트: Beta
- id: beta
- 유형: content
- 경로: ../beta
`

const made: TestCompany[] = []

/** 실제 org.md와 직원 파일 사본에 project.md를 더한 테스트 회사. */
export async function company(): Promise<TestCompany> {
  const c = await makeCompany()
  made.push(c)
  await put(c.dir, 'company/project.md', PROJECT_MD)
  return c
}

export async function cleanup(): Promise<void> {
  for (const c of made.splice(0)) await rm(c.dir, { recursive: true, force: true })
}
