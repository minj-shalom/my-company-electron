import { WEEKLY_LIMIT_MAX, validateWeeklyLimitAmount } from '../../../shared/provider'

export type LimitParse = { ok: true; amount: number | null } | { ok: false; message: string }

/** 입력 칸 문자열을 한도 숫자로 바꾼다. 빈 칸은 "한도 없음"(null). 숫자 외 문자(토큰 같은 문자열 포함)는 거부한다. */
export function parseLimitInput(text: string): LimitParse {
  const t = text.trim().replace(/,/g, '')
  if (t === '') return { ok: true, amount: null }
  if (!/^\d+(\.\d{1,2})?$/.test(t)) {
    return { ok: false, message: '숫자만 입력해 주세요. 소수점은 둘째 자리까지 쓸 수 있어요.' }
  }
  const amount = Number(t)
  if (amount <= 0) return { ok: false, message: '0보다 큰 금액을 입력해 주세요.' }
  if (amount > WEEKLY_LIMIT_MAX) {
    return {
      ok: false,
      message: `${WEEKLY_LIMIT_MAX.toLocaleString('en-US')} 이하로 입력해 주세요.`
    }
  }
  return validateWeeklyLimitAmount(amount)
    ? { ok: true, amount }
    : { ok: false, message: '올바른 금액이 아니에요.' }
}
