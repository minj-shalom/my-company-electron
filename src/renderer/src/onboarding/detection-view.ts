import type { ConnectionTestState, DetectState, ProviderDetection } from '../../../shared/provider'

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

export interface StateView {
  label: string
  tone: Tone
  /** 사용자가 다음에 할 일을 쉬운 말로. */
  help: string
}

const DETECT_VIEWS: Record<DetectState, StateView> = {
  ok: {
    label: '설치됨',
    tone: 'good',
    help: '설치되어 있어요. 아래에서 연결 테스트를 해 볼 수 있어요.'
  },
  'not-installed': {
    label: '설치되지 않음',
    tone: 'warn',
    help: '아직 설치되지 않았어요. 아래 명령을 터미널에 붙여넣어 설치해 주세요.'
  },
  'exec-failed': {
    label: '실행 실패',
    tone: 'bad',
    help: '프로그램을 찾았지만 실행하지 못했어요. 터미널에서 직접 실행해 보고, 안 되면 다시 설치해 주세요.'
  },
  timeout: {
    label: '응답 없음',
    tone: 'bad',
    help: '정해진 시간 안에 답이 없었어요. 처음 실행할 때는 느릴 수 있으니 잠시 뒤 다시 확인해 보세요.'
  }
}

export function detectView(state: DetectState): StateView {
  return DETECT_VIEWS[state]
}

/** 터미널에서 설치했는데 못 찾을 때의 안내. 경로 직접 지정 기능은 없다 (결정 D-014 대기). */
export const NOT_FOUND_AFTER_INSTALL_HELP =
  '터미널에서 설치했는데도 "설치되지 않음"으로 보이나요? 이 앱은 터미널과 조금 다른 환경에서 실행되어 방금 설치한 프로그램을 못 찾을 수 있어요. 먼저 이 앱을 완전히 종료했다가 다시 열고 "다시 확인"을 눌러 보세요. 그래도 같다면 터미널에서 프로그램 이름을 입력했을 때 실행되는지 확인해 주세요.'

const TEST_VIEWS: Record<ConnectionTestState, StateView> = {
  ok: { label: '연결됨', tone: 'good', help: '로그인까지 잘 되어 있어요.' },
  'not-installed': { label: '설치되지 않음', tone: 'warn', help: '먼저 설치해 주세요.' },
  'exec-failed': { label: '실행 실패', tone: 'bad', help: '프로그램을 실행하지 못했어요.' },
  timeout: {
    label: '응답 없음',
    tone: 'bad',
    help: '시간 안에 답이 없었어요. 잠시 뒤 다시 눌러 보세요.'
  },
  failed: {
    label: '연결 안 됨',
    tone: 'bad',
    help: '답을 받지 못했어요. 위 로그인 안내대로 터미널에서 로그인했는지 확인해 주세요.'
  },
  unsupported: {
    label: '테스트 미지원',
    tone: 'neutral',
    help: '이 제공자의 연결 테스트는 아직 지원하지 않아요. 터미널에서 로그인했다면 그대로 진행해도 괜찮아요.'
  }
}

export function connectionTestView(state: ConnectionTestState): StateView {
  return TEST_VIEWS[state]
}

export interface BadgeView {
  label: string
  tone: Tone
}

/** 탭과 카드 머리가 같은 상태 표시를 쓰도록 한 곳에서 정한다. detection이 null이면 아직 결과가 없거나 조회에 실패한 것이다. */
export function providerBadge(
  detection: ProviderDetection | null,
  loading: boolean,
  withVersion = true
): BadgeView {
  if (loading) return { label: '확인 중…', tone: 'neutral' }
  if (!detection) return { label: '확인 못 함', tone: 'neutral' }
  const view = detectView(detection.state)
  const version =
    withVersion && detection.state === 'ok' && detection.version ? ` (${detection.version})` : ''
  return { label: `${view.label}${version}`, tone: view.tone }
}
