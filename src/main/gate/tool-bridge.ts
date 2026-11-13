import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GATE_SERVER_NAME, GATE_TOOL_NAMES, type GateToolName } from '../../shared/gate'
import { EMPLOYEE_ID, TICKET_ID } from '../repository/ids'
import { PROJECT_ID } from '../../shared/project'
import type { RunLaunchOptions } from '../providers/types'
import type { GateService } from './gate-service'
import { startToolServer } from './tool-server'

export interface GateRunRequest {
  projectId: string
  /** 이 실행을 하는 직원. 도구 호출의 `employee`로 감사 기록에 남는다. */
  employeeId: string
  ticketId: string | null
}

export interface GateRunLaunch {
  /** `ProviderAdapter.start`의 세 번째 인자로 그대로 넘긴다. 도구 브리지가 없으면 빈 객체. */
  launch: RunLaunchOptions
  /** 이 실행의 자동 모드가 가능한지. 브리지가 없으면 false (모든 게이트는 컨펌 카드). */
  autoAllowed: boolean
  /** 서버와 임시 파일 정리. `launch.onFinish`가 부르므로 보통 직접 부를 필요는 없고, 여러 번 불러도 안전하다. */
  dispose(): Promise<void>
}

export interface ToolBridgeDeps {
  service: GateService
  /** 직원 id가 조직도에 있는지 확인한다 (임의 id로 감사 기록을 남기지 못하게). */
  isKnownEmployee: (id: string) => Promise<boolean>
  /** 임시 파일 위치. 기본은 OS 임시 폴더 (회사 폴더·프로젝트 폴더 밖). */
  tmpRoot?: string
}

/**
 * 원 명령(`git push`, `gh pr merge`)과 감사·정책 파일 쓰기를 막는 deny 규칙 (D-012 A: 실행별 임시 설정).
 * 이 목록은 접두어 기준이라 우회 가능성이 있다. 허용 목록(`--allowedTools`)에 Bash가 없다는 것이 1차 방어이고 이 규칙은 보조다.
 */
export const DENY_RULES: readonly string[] = [
  'Bash(git push:*)',
  'Bash(git -C:* push:*)',
  'Bash(git reset:*)',
  'Bash(git rebase:*)',
  'Bash(git filter-branch:*)',
  'Bash(gh pr merge:*)',
  'Bash(gh api:*)',
  ...['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].flatMap((t) => [
    `${t}(company/audit/**)`,
    `${t}(company/policies/**)`
  ])
]

/**
 * 실행 한 번을 위한 게이트 도구 서버와 설정 파일을 만든다. 서버·파일은 실행이 끝나면(정상, 취소, 시간 초과, 시작 실패 포함)
 * `onFinish`로 정리된다. 제공자가 브리지를 지원하지 않으면 서버를 만들지 않고 자동 모드를 끈다.
 */
export async function prepareGateRun(
  deps: ToolBridgeDeps,
  req: GateRunRequest,
  provider: { toolBridge: boolean }
): Promise<GateRunLaunch> {
  if (
    !PROJECT_ID.test(req.projectId) ||
    !EMPLOYEE_ID.test(req.employeeId) ||
    (req.ticketId !== null && !TICKET_ID.test(req.ticketId)) ||
    !(await deps.isKnownEmployee(req.employeeId))
  )
    throw new Error('invalid-gate-run')
  if (!provider.toolBridge)
    return { launch: {}, autoAllowed: false, dispose: async () => undefined }

  const server = await startToolServer({
    call: (tool: GateToolName, input) =>
      deps.service.call({ ...req, autoAllowed: true }, tool, input)
  })
  let dir: string | null = null
  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    await server.close().catch(() => undefined)
    if (dir !== null) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  try {
    dir = await mkdtemp(join(deps.tmpRoot ?? tmpdir(), 'mc-gate-'))
    const toolConfigPath = join(dir, 'tools.json')
    const settingsPath = join(dir, 'settings.json')
    const toolConfig = {
      mcpServers: {
        [GATE_SERVER_NAME]: {
          type: 'http',
          url: server.url,
          headers: { Authorization: `Bearer ${server.token}` }
        }
      }
    }
    await writeFile(toolConfigPath, JSON.stringify(toolConfig), { mode: 0o600 })
    await writeFile(settingsPath, JSON.stringify({ permissions: { deny: DENY_RULES } }), {
      mode: 0o600
    })
    return {
      autoAllowed: true,
      dispose,
      launch: {
        tools: { allowedTools: GATE_TOOL_NAMES, toolConfigPath, settingsPath },
        onFinish: dispose
      }
    }
  } catch (e) {
    await dispose()
    throw e
  }
}
