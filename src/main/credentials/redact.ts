/**
 * 자격 증명 값 마스킹. 값이 로그·오류·감사·카드로 새지 않도록 기록 직전에 쓴다.
 * 보관소가 값을 다룰 때마다 등록하므로, 등록된 값은 어떤 문자열에서도 `[REDACTED]`가 된다.
 */
export const REDACTED = '[REDACTED]'

/** 값을 몰라도 흔한 토큰 모양은 가린다 (Bearer, `access_token=...`, JWT 모양). */
const PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(access_token|refresh_token|id_token|client_secret|code_verifier|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g
]

/** 이름·구분자 그룹이 있는 패턴은 이름을 남기고 값만 가린다. 그룹이 없으면 전체를 가린다. */
function replacement(m: unknown[]): string {
  const [, key, sep] = m
  return typeof key === 'string'
    ? `${key}${typeof sep === 'string' ? sep : '='}${REDACTED}`
    : REDACTED
}

const MIN_SECRET_LENGTH = 6

export class SecretRegistry {
  private readonly values = new Set<string>()

  /** 너무 짧은 값은 일반 문자열을 망가뜨리므로 등록하지 않는다 (보관소는 더 긴 값만 받는다). */
  register(value: string): void {
    if (value.length >= MIN_SECRET_LENGTH) this.values.add(value)
  }

  clear(): void {
    this.values.clear()
  }

  mask(text: string): string {
    let out = text
    // 긴 값부터 치환해 한 값이 다른 값의 일부일 때도 남지 않게 한다.
    for (const v of [...this.values].sort((a, b) => b.length - a.length))
      out = out.split(v).join(REDACTED)
    for (const p of PATTERNS) out = out.replace(p, (...m: unknown[]) => replacement(m))
    return out
  }
}

/** 프로세스 공용 레지스트리. 로거와 오류 변환이 같은 목록을 본다. */
export const secrets = new SecretRegistry()

export function maskSecrets(text: string): string {
  return secrets.mask(text)
}

export type LogSink = (line: string) => void

/** 모든 인자를 문자열로 만든 뒤 마스킹해 sink로 보낸다. 객체는 JSON으로 직렬화하고 순환은 가린다. */
export interface SafeLogger {
  log: (...args: unknown[]) => void
  error: (label: string, err?: unknown) => void
}

export function createSafeLogger(sink: LogSink, registry: SecretRegistry = secrets): SafeLogger {
  const render = (a: unknown): string => {
    if (typeof a === 'string') return a
    if (a instanceof Error) return a.name
    try {
      return JSON.stringify(a) ?? String(a)
    } catch {
      return '[unserializable]'
    }
  }
  return {
    log: (...args: unknown[]): void => sink(registry.mask(args.map(render).join(' '))),
    // 오류는 메시지에 값이 섞일 수 있으므로 이름만 남긴다.
    error: (label: string, err?: unknown): void =>
      sink(registry.mask(`${label}${err === undefined ? '' : ` (${render(err)})`}`))
  }
}
