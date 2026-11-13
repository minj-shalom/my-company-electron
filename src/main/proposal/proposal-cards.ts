import type { ProposalAction } from '../../shared/proposal'
import type { GateCards } from '../gate/gate-cards'
import { extractProposalBlocks, parseProposalBlock, renderProposalBlock } from './proposal-block'

const MAX_CARDS_PER_RESULT = 5

const short = (v: string, n = 40): string => (v.length > n ? `${v.slice(0, n)}…` : v)

/** 카드 요약은 한 줄 고정 문장이다. 권한에 영향을 주는 값(도구, 모델, 정책 값)은 CEO가 요약에서 볼 수 있게 담는다. */
export function describe(a: ProposalAction): string {
  switch (a.action) {
    case 'assign':
      return `${a.employee}를 ${a.project} 프로젝트에 배정`
    case 'unassign':
      return `${a.employee}의 ${a.project} 프로젝트 배정 해제`
    case 'hire':
      return `${a.id} 채용 (${a.department})`
    case 'update': {
      const parts = [
        a.tools !== undefined ? `도구: ${short(a.tools.join(', '), 60)}` : null,
        a.model !== undefined ? `모델: ${a.model}` : null,
        a.description !== undefined ? '설명 수정' : null,
        a.after !== undefined ? '재편집 해시 승인' : null
      ].filter((x) => x !== null)
      return `${a.id} 직원 파일 수정 (${parts.join(', ')})`
    }
    case 'move':
      return `${a.id} 부서·보고 라인 변경`
    case 'retire':
      return `${a.id} 퇴사 처리`
    case 'policy-change':
      return `${a.project} 프로젝트 정책 변경 (값: ${short(JSON.stringify(a.values), 120)})`
  }
}

/** 앞의 5건만 나열하고 나머지는 건수로 알린다. */
export function summarize(actions: readonly ProposalAction[]): string {
  const lines = actions.slice(0, 5).map(describe)
  if (actions.length > 5) lines.push(`외 ${actions.length - 5}건`)
  return lines.join(' / ')
}

export interface ProposalCardResult {
  /** 만든 카드 번호. */
  cardIds: string[]
  /** 형식 검증에 실패해 카드를 만들지 않은 블록 수. */
  rejected: number
}

/**
 * hr(또는 COO)의 최종 응답에서 `proposal` 블록을 꺼내 승인 카드로 만든다 (hr은 카드를 직접 쓰지 못한다).
 * 블록은 파서를 통과한 액션으로 다시 렌더링해서 쓰므로 카드에는 원문 텍스트가 그대로 들어가지 않는다.
 * 경로 제한을 지원하지 않는 제공자의 대체 경로에서도 같은 함수가 쓰인다.
 */
export async function createProposalCards(
  cards: GateCards,
  proposedBy: 'hr' | 'coo',
  resultText: string
): Promise<ProposalCardResult> {
  const out: ProposalCardResult = { cardIds: [], rejected: 0 }
  const blocks = extractProposalBlocks(resultText)
  for (const [i, block] of blocks.entries()) {
    const parsed = parseProposalBlock(block)
    if (!parsed.ok || i >= MAX_CARDS_PER_RESULT) {
      out.rejected++
      continue
    }
    out.cardIds.push(
      await cards.create({
        kind: 'proposal',
        title: `인사 변경 승인 요청 (${parsed.actions.length}건)`,
        ticketId: null,
        question: summarize(parsed.actions),
        options: [
          {
            key: 'A',
            label: '승인',
            description: '앱이 변경을 적용합니다. 승인 전에는 적용되지 않습니다.'
          },
          { key: 'B', label: '거절', description: '변경하지 않고 카드를 닫습니다.' }
        ],
        impact:
          '승인하면 기록(감사 줄)이 남고, 기준값이 바뀌었으면 적용하지 않고 다시 제안받습니다.',
        reason: '민감한 변경은 CEO 승인이 필요합니다.',
        proposedBy,
        block: renderProposalBlock(parsed.actions)
      })
    )
  }
  return out
}
