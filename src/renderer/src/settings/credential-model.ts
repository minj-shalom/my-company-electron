import type { CredentialAdapterStatus, CredentialState } from '../../../shared/publisher'
import type { BadgeTone } from '../ui/Badge'

/** 화면 문구는 고정 문구만 쓴다. main이 준 오류 원문은 보여 주지 않는다. */
export const CREDENTIAL_NOTES = [
  '제공자 CLI 로그인은 이 앱이 저장하지 않아요.',
  '발행 자격 증명은 이 컴퓨터의 보안 저장소에만 보관돼요.'
] as const
export const CREDENTIAL_LOAD_ERROR = '외부 연결 상태를 불러오지 못했어요. 다시 시도해 주세요.'
export const CREDENTIAL_DISCONNECT_ERROR = '연결을 해제하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
export const CREDENTIAL_EMPTY =
  '지금은 직접 올리는 방식만 있어요. 연결할 외부 서비스가 아직 없어요.'
export const NO_ENCRYPTION_NOTE = '이 컴퓨터에서는 안전하게 보관할 수 없어서 연결할 수 없어요.'
export const NOT_REVOKED_NOTE =
  '서버 쪽 폐기는 못 했지만 이 컴퓨터의 값은 지웠어요. 필요하면 해당 서비스 설정에서 직접 연결을 끊어 주세요.'
export const DISCONNECTED_NOTE = '연결을 해제했어요. 이 컴퓨터의 값을 지웠어요.'
export const CONNECT_PENDING_NOTE = '연결하기는 준비 중이에요.'

const STATE_VIEW: Record<CredentialState, { label: string; tone: BadgeTone }> = {
  connected: { label: '연결됨', tone: 'good' },
  disconnected: { label: '연결 안 됨', tone: 'neutral' },
  expiring: { label: '곧 만료', tone: 'warn' },
  error: { label: '오류', tone: 'bad' }
}

export function credentialStateView(state: CredentialState): { label: string; tone: BadgeTone } {
  return STATE_VIEW[state]
}

export function formatExpiry(iso: string | null): string {
  if (iso === null) return '만료 없음'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '만료 시각 알 수 없음'
  const text = new Date(t).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
  return t < Date.now() ? `${text}에 만료됨` : `${text}까지`
}

/** 직접 올리기(manual)는 연결할 자격 증명이 없어 목록에서 뺀다. */
export function connectableAdapters(items: CredentialAdapterStatus[]): CredentialAdapterStatus[] {
  return items.filter((i) => i.adapterId !== 'manual')
}

export function canDisconnect(item: CredentialAdapterStatus): boolean {
  return item.state !== 'disconnected' || item.accounts.length > 0
}
