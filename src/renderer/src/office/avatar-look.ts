/** 직원별 아바타 외형 선택 (순수 함수). 같은 직급이면 항상 같은 모습이다. */

export interface AvatarLook {
  skin: 1 | 2 | 3
  hair: 1 | 2 | 3
  /** 0 짧은 머리, 1 긴 머리 */
  style: 0 | 1
}

/** FNV-1a. 외형을 고르는 용도라 암호학적 성질은 필요 없다. */
export function hashTitle(title: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < title.length; i += 1) {
    h ^= title.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function lookFor(title: string): AvatarLook {
  const h = hashTitle(title)
  return {
    skin: ((h % 3) + 1) as AvatarLook['skin'],
    hair: ((Math.floor(h / 3) % 3) + 1) as AvatarLook['hair'],
    style: (Math.floor(h / 9) % 2) as AvatarLook['style']
  }
}

/** 이름표에 쓸 짧은 글자. 전체 이름은 직원 목록에서 볼 수 있다. */
export function shortLabel(title: string, max = 7): string {
  const chars = [...title.trim()]
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`
}
