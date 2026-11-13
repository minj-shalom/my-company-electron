import {
  MAX_BRANCH,
  MAX_DEV_COMMAND,
  PROJECT_ID,
  PROJECT_TYPES,
  checkProjectName,
  hasForbiddenChar,
  type ProjectType
} from '../../shared/project'
import { EMPLOYEE_ID } from '../repository/ids'
import { isValidBranch } from './project-doc'

/** IPC 요청 검증. 알 수 없는 키(`__proto__` 포함)와 객체가 아닌 값은 거부한다. */

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }
const bad = (message = '요청 형식이 올바르지 않습니다.'): { ok: false; message: string } => ({
  ok: false,
  message
})

function plain(raw: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const proto = Object.getPrototypeOf(raw) as unknown
  if (proto !== Object.prototype && proto !== null) return null
  return Object.keys(raw).every((k) => allowed.includes(k))
    ? (raw as Record<string, unknown>)
    : null
}

const id = (v: unknown): v is string => typeof v === 'string' && PROJECT_ID.test(v)
const employeeId = (v: unknown): v is string => typeof v === 'string' && EMPLOYEE_ID.test(v)
const projectType = (v: unknown): v is ProjectType =>
  typeof v === 'string' && (PROJECT_TYPES as readonly string[]).includes(v)

export function parseId(raw: unknown): Parsed<{ id: string }> {
  const o = plain(raw, ['id'])
  return o && id(o.id) ? { ok: true, value: { id: o.id } } : bad('프로젝트 id가 올바르지 않습니다.')
}

export function parseRename(raw: unknown): Parsed<{ id: string; name: string }> {
  const o = plain(raw, ['id', 'name'])
  if (!o || !id(o.id)) return bad('프로젝트 id가 올바르지 않습니다.')
  const msg = checkProjectName(o.name)
  return msg === null ? { ok: true, value: { id: o.id, name: o.name as string } } : bad(msg)
}

export function parseSetType(raw: unknown): Parsed<{ id: string; type: ProjectType }> {
  const o = plain(raw, ['id', 'type'])
  if (!o || !id(o.id)) return bad('프로젝트 id가 올바르지 않습니다.')
  return projectType(o.type)
    ? { ok: true, value: { id: o.id, type: o.type } }
    : bad('유형이 올바르지 않습니다.')
}

export function parseSetPm(raw: unknown): Parsed<{ id: string; pm: string }> {
  const o = plain(raw, ['id', 'pm'])
  if (!o || !id(o.id)) return bad('프로젝트 id가 올바르지 않습니다.')
  return employeeId(o.pm)
    ? { ok: true, value: { id: o.id, pm: o.pm } }
    : bad('직원 id가 올바르지 않습니다.')
}

export interface AddInput {
  path: string
  name: string
  type: ProjectType
  devCommand: string | null
  defaultBranch: string | null
  pm: string | null
}

export function parseAdd(raw: unknown): Parsed<AddInput> {
  const o = plain(raw, ['path', 'name', 'type', 'devCommand', 'defaultBranch', 'pm'])
  if (!o) return bad()
  if (typeof o.path !== 'string') return bad('경로가 올바르지 않습니다.')
  const msg = checkProjectName(o.name)
  if (msg !== null) return bad(msg)
  const type = o.type === undefined ? 'development' : o.type
  if (!projectType(type)) return bad('유형이 올바르지 않습니다.')
  let devCommand: string | null = null
  if (o.devCommand !== undefined) {
    if (
      type !== 'development' ||
      typeof o.devCommand !== 'string' ||
      o.devCommand.length === 0 ||
      o.devCommand.length > MAX_DEV_COMMAND ||
      o.devCommand !== o.devCommand.trim() ||
      hasForbiddenChar(o.devCommand)
    )
      return bad('dev 명령이 올바르지 않습니다.')
    devCommand = o.devCommand
  }
  let defaultBranch: string | null = null
  if (o.defaultBranch !== undefined) {
    if (
      type !== 'development' ||
      typeof o.defaultBranch !== 'string' ||
      o.defaultBranch.length > MAX_BRANCH ||
      !isValidBranch(o.defaultBranch)
    )
      return bad('기본 브랜치 이름이 올바르지 않습니다.')
    defaultBranch = o.defaultBranch
  }
  if (o.pm !== undefined && !employeeId(o.pm)) return bad('직원 id가 올바르지 않습니다.')
  return {
    ok: true,
    value: {
      path: o.path,
      name: o.name as string,
      type,
      devCommand,
      defaultBranch,
      pm: (o.pm as string | undefined) ?? null
    }
  }
}
