import { realpath } from 'node:fs/promises'
import { PROJECT_ID } from '../../shared/project'
import type { Ticket } from '../../shared/ticket'
import type { CompanyContext } from '../company/company-context'
import { createFileGateCards } from '../gate/gate-cards'
import { gateRuntimeFor } from '../gate/gate-runtime'
import { prepareGateRun } from '../gate/tool-bridge'
import { hrRunnerFor } from '../hr/hr-runtime'
import { integrityFor } from '../integrity/integrity-runtime'
import { loadOrg, agentIdSet } from '../org/org-store'
import { policyServiceFor } from '../policy/policy-ipc'
import { projectServiceFor } from '../project/project-ipc'
import type { ProviderAdapter } from '../providers/types'
import { EMPLOYEE_ID } from '../repository/ids'
import { splitFrontmatter } from '../repository/markdown'
import { sharedRepository } from '../repository/shared-repository'
import type { TickDeps } from './tick-types'

export interface TickWiringOptions {
  context: CompanyContext
  userDataDir: string
  /** cwd마다 제공자 어댑터를 만든다. */
  createAdapter: (cwd: string, employeeId?: string) => ProviderAdapter
  /** 후속 티켓(T-019 한도 점검, T-046/T-052 요청 경로, T-052 hr 전용 실행)이 채우는 연결점. */
  checkLimit?: TickDeps['checkLimit']
  requests?: TickDeps['requests']
  hr?: TickDeps['hr']
  now?: () => Date
}

const ticketNumber = (t: Ticket): number => Number(/\d+/.exec(t.id)?.[0] ?? 0)
const byNumber = (a: Ticket, b: Ticket): number => ticketNumber(a) - ticketNumber(b)

/**
 * 열린 회사에 묶인 틱 입력. 틱 하나가 끝날 때까지 같은 회사를 쓰도록 틱 시작 때 호출해서 만든다.
 * 파일 접근은 모두 SafeFs, 프로젝트 폴더는 T-037에 등록된 경로만 쓴다.
 */
export function tickDepsFor(o: TickWiringOptions): TickDeps {
  const { fs } = o.context.requireOpenCompany()
  const repo = sharedRepository(fs)
  const exclusive = <T>(t: () => Promise<T>): Promise<T> => repo.runExclusive(t)
  const gate = gateRuntimeFor({ context: o.context, userDataDir: o.userDataDir })
  const policyDeps = { context: o.context }
  const readAgentPrompt = async (employeeId: string): Promise<string | null> => {
    if (!EMPLOYEE_ID.test(employeeId)) return null
    try {
      return splitFrontmatter(await fs.readText(`.claude/agents/${employeeId}.md`)).body
    } catch {
      return null
    }
  }
  return {
    now: o.now ?? ((): Date => new Date()),
    companyDir: () => fs.root,
    loadSnapshot: async () => {
      const [inProgress, backlog] = await Promise.all([
        repo.listTickets('in-progress'),
        repo.listTickets('backlog')
      ])
      const org = await loadOrg(fs)
      const projects = await projectServiceFor(policyDeps).list()
      return {
        tickets: [...inProgress.items.sort(byNumber), ...backlog.items.sort(byNumber)],
        // 조직도를 읽지 못했으면 null: 프로젝트는 "PM 필요"로, 직원은 "없음"으로 보수적으로 취급된다.
        org: org.issues.some((i) => i.code === 'unreadable') ? null : org,
        projects: projects.ok ? projects.value.items : null,
        quarantined: new Set(await integrityFor(o).quarantined())
      }
    },
    loadPolicy: async (projectId) => {
      const r = await policyServiceFor(policyDeps).get({ projectId })
      return r.ok ? r.value : null
    },
    readAgentPrompt,
    resolveProjectDir: async (projectId) => {
      if (!PROJECT_ID.test(projectId)) return null
      const list = await projectServiceFor(policyDeps).list()
      if (!list.ok) return null
      const p = list.value.items.find((x) => x.id === projectId)
      if (p === undefined || p.status !== 'active') return null
      return realpath(p.path).catch(() => null)
    },
    createAdapter: o.createAdapter,
    writeReport: async (id, markdown) => {
      const r = await repo.createReport(id, markdown)
      if (r.ok) return 'written'
      if (r.code === 'conflict') return 'exists'
      throw new Error('report-write-failed')
    },
    createCard: (input) =>
      createFileGateCards({ fs, exclusive }).create({
        kind: 'decision',
        title: input.title,
        ticketId: input.ticketId,
        question: input.question,
        impact: input.impact,
        options: [
          {
            key: 'A',
            label: '계속 보류',
            description: '한도가 회복될 때까지 틱을 실행하지 않습니다.'
          },
          {
            key: 'B',
            label: '한도 확인 후 진행',
            description: '사용량을 확인한 뒤 직접 지시합니다.'
          }
        ]
      }),
    // 킬 스위치는 읽지 못하면 켜진 것으로 본다 (KillSwitch.isEngaged가 그렇게 답한다).
    isKillSwitchEngaged: async (projectId) =>
      projectId === null
        ? (await gate.killSwitch.get()).company
        : gate.killSwitch.isEngaged(projectId),
    prepareToolRun: async (req, provider) =>
      prepareGateRun(
        {
          service: gate.service,
          isKnownEmployee: async (id) => (await agentIdSet(fs)).has(id)
        },
        req,
        provider
      ),
    checkLimit: o.checkLimit,
    requests: o.requests,
    // hr 전용 실행(T-059): 요청 파일이 있을 때만 돌고, 제공자가 경로 제한을 지원하지 않으면 실행하지 않는다.
    hr:
      o.hr ??
      hrRunnerFor({
        context: o.context,
        userDataDir: o.userDataDir,
        createAdapter: (cwd) => o.createAdapter(cwd, 'hr'),
        readAgentPrompt
      })
  }
}
