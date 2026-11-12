import type { ProviderCliId } from '../../../shared/provider'

/**
 * 제공자별 설치/로그인 안내. 복사 명령은 모두 고정 문자열이며 사용자 입력이 섞이지 않는다.
 * 근거(2026-11 확인): 각 CLI 공식 GitHub README의 설치 섹션.
 *  - Claude Code: https://github.com/anthropics/claude-code (설치 문서 https://code.claude.com/docs/en/setup)
 *  - Codex CLI: https://github.com/openai/codex
 *  - Gemini CLI: https://github.com/google-gemini/gemini-cli
 * 로그인은 앱이 대신하지 않는다. 사용자가 터미널에서 CLI를 실행해 직접 한다.
 */
export type OsKind = 'unix' | 'windows'

export interface InstallCommand {
  label: string
  command: string
}

export interface ProviderGuide {
  id: ProviderCliId
  name: string
  /** 사용자가 아는 서비스 이름 (예: ChatGPT 구독으로 쓰는 Codex). */
  service: string
  docsUrl: string
  install: Record<OsKind, InstallCommand[]>
  installNote?: string
  loginCommand: string
  loginSteps: string[]
}

export const OS_LABELS: Record<OsKind, string> = {
  unix: 'Mac / Linux',
  windows: 'Windows'
}

export const PROVIDER_GUIDES: readonly ProviderGuide[] = [
  {
    id: 'claude',
    name: 'Claude',
    service: 'Anthropic Claude (Claude Code)',
    docsUrl: 'https://code.claude.com/docs/en/setup',
    install: {
      unix: [
        { label: '터미널에 붙여넣기', command: 'curl -fsSL https://claude.ai/install.sh | bash' }
      ],
      windows: [
        { label: 'PowerShell에 붙여넣기', command: 'irm https://claude.ai/install.ps1 | iex' }
      ]
    },
    loginCommand: 'claude',
    loginSteps: [
      '터미널(Windows는 PowerShell)을 엽니다.',
      '아래 명령을 입력하고 Enter를 누릅니다.',
      '화면에 나오는 안내에 따라 Claude 계정으로 로그인합니다.'
    ]
  },
  {
    id: 'codex',
    name: 'ChatGPT',
    service: 'OpenAI ChatGPT (Codex)',
    docsUrl: 'https://github.com/openai/codex',
    install: {
      unix: [
        {
          label: '터미널에 붙여넣기',
          command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'
        }
      ],
      windows: [
        {
          label: 'PowerShell에 붙여넣기',
          command:
            'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
        }
      ]
    },
    loginCommand: 'codex',
    loginSteps: [
      '터미널(Windows는 PowerShell)을 엽니다.',
      '아래 명령을 입력하고 Enter를 누릅니다.',
      '"Sign in with ChatGPT"를 골라 ChatGPT 계정으로 로그인합니다.'
    ]
  },
  {
    id: 'gemini',
    name: 'Gemini',
    service: 'Google Gemini (Gemini CLI)',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    install: {
      unix: [
        { label: 'Node.js(npm)가 있을 때', command: 'npm install -g @google/gemini-cli' },
        { label: 'Homebrew가 있을 때', command: 'brew install gemini-cli' }
      ],
      windows: [{ label: 'Node.js(npm)가 있을 때', command: 'npm install -g @google/gemini-cli' }]
    },
    installNote:
      'Gemini는 Node.js가 먼저 설치되어 있어야 합니다. 없다면 아래 공식 문서 링크의 안내를 먼저 확인하세요.',
    loginCommand: 'gemini',
    loginSteps: [
      '터미널(Windows는 PowerShell)을 엽니다.',
      '아래 명령을 입력하고 Enter를 누릅니다.',
      '"Sign in with Google"을 골라 Google 계정으로 로그인합니다.'
    ]
  }
]

export function guessOs(platformHint: string): OsKind {
  return /win/i.test(platformHint) && !/darwin/i.test(platformHint) ? 'windows' : 'unix'
}
