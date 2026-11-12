import { stringify as stringifyYaml } from 'yaml'
import {
  EMPLOYEE_MODELS,
  MAX_EMPLOYEE_BODY_BYTES,
  MAX_EMPLOYEE_DESCRIPTION,
  MAX_EMPLOYEE_TOOLS
} from '../../shared/employee-change'
import { splitFrontmatter } from '../repository/markdown'
import { CONTROL_CHARS } from '../org/parse-org-doc'

// 직원 파일은 AI 에이전트가 시스템 프롬프트로 읽는다. 줄바꿈 변형이나 제어 문자가 frontmatter 닫기, 가짜 헤딩 같은
// 구조 위조를 만들지 못하게 한 줄 값은 거부하고 본문은 `\n`으로 정규화한다. 모든 패턴은 줄 단위/단일 문자 클래스라 선형이다.

// eslint-disable-next-line no-control-regex -- 줄바꿈 변형(VT, FF 포함) 정규화가 목적
const ANY_LINE_BREAK = /\r\n|[\r\u0085\u2028\u2029\u000b\u000c]/g
// eslint-disable-next-line no-control-regex -- 제어 문자 검출이 목적 (탭과 줄바꿈은 제외)
const BODY_CONTROL = /[\u0000-\u0008\u000e-\u001f\u007f\ufeff]/
const MAX_TOOL_LENGTH = 200
// 괄호 인자(`Bash(git:*)`)는 허용하되 콤마(목록 구분자), 괄호, 제어 문자는 막는다.
const TOOL_NAME =
  // eslint-disable-next-line no-control-regex -- 제어 문자 제외가 목적
  /^[A-Za-z][A-Za-z0-9_]{0,63}(?:\([^(),\u0000-\u001f\u007f\u0085\u2028\u2029]{1,100}\))?$/

/** 쓰기 또는 임의 실행이 가능한 도구. 직원 `tools`에 추가·확대하는 변경은 민감 변경이다. */
const POWER_TOOLS = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string }

export function checkDescription(v: unknown): Checked<string> {
  if (typeof v !== 'string') return { ok: false, message: '설명 형식이 올바르지 않습니다.' }
  if (v.length > MAX_EMPLOYEE_DESCRIPTION * 2) return { ok: false, message: '설명이 너무 깁니다.' }
  const t = v.trim()
  if (t.length === 0 || t.length > MAX_EMPLOYEE_DESCRIPTION)
    return { ok: false, message: '설명 길이가 올바르지 않습니다.' }
  if (CONTROL_CHARS.test(t) || t.includes('\ufeff'))
    return { ok: false, message: '설명에 줄바꿈이나 제어 문자를 쓸 수 없습니다.' }
  return { ok: true, value: t }
}

export function checkModel(v: unknown): Checked<string> {
  return typeof v === 'string' && (EMPLOYEE_MODELS as readonly string[]).includes(v)
    ? { ok: true, value: v }
    : { ok: false, message: '허용되지 않는 모델입니다.' }
}

export function checkTools(v: unknown): Checked<string[]> {
  if (!Array.isArray(v) || v.length > MAX_EMPLOYEE_TOOLS)
    return { ok: false, message: '도구 목록 형식이 올바르지 않습니다.' }
  const seen = new Set<string>()
  for (const t of v as unknown[]) {
    if (typeof t !== 'string' || t.length > MAX_TOOL_LENGTH || !TOOL_NAME.test(t) || seen.has(t))
      return { ok: false, message: '허용되지 않는 도구 이름입니다.' }
    seen.add(t)
  }
  return { ok: true, value: [...seen] }
}

/** 본문을 `\n` 줄바꿈으로 정규화하고 앞뒤 빈 줄을 정리한다. 끝은 줄바꿈 하나. */
export function checkBody(v: unknown): Checked<string> {
  if (typeof v !== 'string') return { ok: false, message: '본문 형식이 올바르지 않습니다.' }
  // 길이를 먼저 본다: 바이트 상한을 넘는 입력에 정규화를 돌리지 않는다.
  if (v.length > MAX_EMPLOYEE_BODY_BYTES) return { ok: false, message: '본문이 너무 깁니다.' }
  const text = v.replace(ANY_LINE_BREAK, '\n')
  if (BODY_CONTROL.test(text))
    return { ok: false, message: '본문에 허용되지 않는 문자가 있습니다.' }
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: false, message: '본문이 비어 있습니다.' }
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_EMPLOYEE_BODY_BYTES)
    return { ok: false, message: '본문이 너무 깁니다.' }
  return { ok: true, value: `${trimmed}\n` }
}

/** frontmatter `tools`(콤마 문자열 또는 목록)를 목록으로 읽는다. */
export function readTools(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

const baseName = (tool: string): string => tool.split('(')[0]
const isPower = (tool: string): boolean =>
  POWER_TOOLS.has(baseName(tool)) || baseName(tool).startsWith('mcp__')

/**
 * 도구 확대인지. `tools` 키가 없으면 모든 도구를 상속하므로 지정 목록 -> 키 없음(빈 목록)은 확대다.
 * 새 목록에 이전에 없던 Bash/쓰기/MCP 도구가 있어도 확대다 (`Bash(git:*)` -> `Bash`처럼 인자가 달라져도 포함).
 */
export function isToolsExpansion(before: string[] | null, after: string[]): boolean {
  if (before === null) return false
  if (after.length === 0) return true
  const old = new Set(before)
  return after.some((t) => isPower(t) && !old.has(t))
}

/** 직원 파일 본문. 본문은 이미 `checkBody`를 거치거나 기존 파일의 것이다. */
export function buildAgentFile(data: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(data, { lineWidth: 0 })}---\n\n${body}`
}

/** 쓰려는(또는 쓴) 텍스트를 다시 파싱해 의도한 필드와 본문이 그대로 읽히는지 확인한다. */
export function verifyAgentFile(
  text: string,
  expected: { name?: string; description: string; model?: string; tools: string[]; body: string }
): boolean {
  try {
    const { data, body } = splitFrontmatter(text)
    if (data.name !== expected.name || data.description !== expected.description) return false
    if (expected.model !== undefined && data.model !== expected.model) return false
    const tools = readTools(data.tools)
    if (JSON.stringify(tools) !== JSON.stringify(expected.tools)) return false
    if (expected.tools.length === 0 && 'tools' in data) return false
    return body === `\n${expected.body}`
  } catch {
    return false
  }
}
