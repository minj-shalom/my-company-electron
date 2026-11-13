import type { OrgMember, OrgModel } from '../../shared/org'
import type { PolicyState } from '../../shared/policy'
import type { ProjectInfo } from '../../shared/project'
import type { Ticket } from '../../shared/ticket'
import type { TickSnapshot } from './tick-types'

export function agent(id: string, title = id.toUpperCase()): OrgMember {
  return {
    title,
    kind: 'agent',
    agentId: id,
    fileExists: true,
    department: 'dev',
    reportsTo: null,
    role: ''
  }
}

export function org(...members: OrgMember[]): OrgModel {
  return { members, departments: [], tree: [], chart: [], issues: [] }
}

export function ticket(id: string, patch: Partial<Ticket> = {}): Ticket {
  return {
    id,
    title: `제목 ${id}`,
    status: 'backlog',
    assignee: 'developer',
    department: null,
    projectId: null,
    body: `본문 ${id}`,
    ...patch
  }
}

export function project(id: string, patch: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: `프로젝트 ${id}`,
    type: 'development',
    path: `/tmp/${id}`,
    devCommand: null,
    defaultBranch: null,
    status: 'active',
    pmId: 'pm',
    memberIds: ['developer'],
    pm: { id: 'pm', name: 'pm' },
    state: 'ready',
    git: { status: 'not-repo' },
    ...patch
  }
}

export function snapshot(patch: Partial<TickSnapshot> = {}): TickSnapshot {
  return {
    tickets: [],
    org: org(agent('pm', 'PM'), agent('developer')),
    projects: [],
    quarantined: new Set(),
    ...patch
  }
}

export function policyState(patch: Partial<PolicyState['effective']> = {}): PolicyState {
  return {
    projectId: 'alpha',
    exists: true,
    revision: 'r',
    values: {
      flow: 'dev-git-pr',
      modes: { push: 'every', merge: 'every', publish: 'every', 'draft-approve': 'every' },
      dailyLimits: {},
      autoPushPrefixes: [],
      autoMergeBranches: [],
      confirmInput: null,
      branchPrefix: 'feature/',
      baseBranch: 'develop',
      usePr: true,
      reviewStage: 'required',
      dailyOutputGoal: 1,
      outputDir: 'out',
      publishAdapter: 'manual',
      activeHours: null,
      memo: null
    },
    effective: {
      flow: 'dev-git-pr',
      modes: { push: 'every', merge: 'every', publish: 'every', 'draft-approve': 'every' },
      dailyLimits: {},
      autoPushPrefixes: [],
      autoMergeBranches: [],
      protectedMergeEnabled: false,
      usePr: true,
      reviewStage: 'required',
      ...patch
    },
    activation: null,
    warnings: [],
    history: []
  }
}
