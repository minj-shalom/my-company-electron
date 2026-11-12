import { createContext } from 'react'

/** 목록에서 현재 탭 정지점이 되는 직원 직급. 목록 밖이면 undefined(항상 탭 가능). */
export const TabbableContext = createContext<string | undefined>(undefined)

/**
 * 목록 안의 직원 버튼을 하나의 탭 정지점으로 묶고 위/아래/Home/End로 옮긴다 (roving tabindex).
 * 대상은 `data-org-item` 속성을 가진 버튼이며, 포커스만 옮기고 선택은 Enter/Space(클릭)로 한다.
 */
