import type { InstallCommand } from './provider-guide'

/** 명령 문자열에서 출처 URL을 텍스트로 뽑는다. 화면에 링크가 아닌 글자로도 보여 주기 위함이다. */
export function extractSourceUrls(commands: readonly InstallCommand[]): string[] {
  const urls = new Set<string>()
  for (const c of commands) {
    for (const m of c.command.matchAll(/https:\/\/[^\s"'|]+/g)) urls.add(m[0])
  }
  return [...urls]
}

/** 인터넷에서 받은 스크립트를 파이프로 바로 실행하는 명령인지. */
export function isPipedInstaller(command: string): boolean {
  return /\|\s*(bash|sh|iex)\b/.test(command)
}

export function usesExecutionPolicyBypass(command: string): boolean {
  return /-ExecutionPolicy\s+ByPass/i.test(command)
}

export const SAFETY_TEXT = {
  piped:
    '아래 명령은 인터넷에서 설치 파일(스크립트)을 내려받아 바로 실행해요. 공식 사이트에서 가져오는 명령이지만, 실행하기 전에 출처를 꼭 확인하세요.',
  runByYou:
    '이 앱은 설치 명령을 대신 실행하지 않아요. 복사해서 터미널에 직접 붙여넣어 실행하는 것은 여러분이에요.',
  doubt: '조금이라도 불안하면 아래 "공식 문서 열기"를 먼저 읽어 보고 진행하세요.',
  bypass:
    '"-ExecutionPolicy ByPass"는 이번 한 번의 실행에서만 PowerShell의 실행 제한 설정을 건너뛰어요. 컴퓨터의 설정이 영구적으로 바뀌지는 않아요.'
} as const
