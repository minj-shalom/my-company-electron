/** 캔버스 색. 값의 원본은 tokens.css이고, 여기서는 CSS 변수를 읽어 PixiJS가 쓰는 숫자 색으로 바꾼다. */

export const PALETTE_TOKENS = [
  'bg-app',
  'bg-panel',
  'bg-inset',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'focus',
  'warn',
  'working',
  'shadow-color',
  'floor-a',
  'floor-b',
  'office-desk',
  'skin-1',
  'skin-2',
  'skin-3',
  'hair-1',
  'hair-2',
  'hair-3',
  'dept-exec',
  'dept-rnd',
  'dept-fin',
  'dept-plan'
] as const
export type PaletteToken = (typeof PALETTE_TOKENS)[number]
export type Palette = Readonly<Record<PaletteToken, number>>

/** 폴백 전용: 토큰을 읽지 못했을 때만 쓰는 중간 회색(테마 색이 아니다). 화면이 깨지지는 않는다. */
const MISSING = 0x808080

/** `#rgb`/`#rrggbb`만 받는다. 그 밖의 값(공백 포함)은 null. */
export function parseCssColor(value: string): number | null {
  const v = value.trim()
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v)
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return parseInt(h, 16)
}

export function readPalette(el: Element = document.documentElement): Palette {
  const style = getComputedStyle(el)
  const out = {} as Record<PaletteToken, number>
  for (const t of PALETTE_TOKENS) {
    out[t] = parseCssColor(style.getPropertyValue(`--${t}`)) ?? MISSING
  }
  return out
}

/** 캔버스에 쓰는 글꼴(`--font-pixel`)의 첫 글꼴 이름. 목록 전체를 PixiJS에 넘기면 따옴표 처리가 달라진다. */
export function readPixelFontFamily(el: Element = document.documentElement): string {
  const raw = getComputedStyle(el).getPropertyValue('--font-pixel')
  const first = raw
    .split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '')
  return first || 'sans-serif'
}
