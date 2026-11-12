import type { AgentDefinitionTranslator } from '../types'

/**
 * Claude는 회사 폴더의 `.claude/agents/*.md`를 작업 디렉터리에서 그대로 읽으므로 변환할 파일이 없다.
 * 다른 제공자 어댑터는 같은 인터페이스로 해당 CLI의 지침 파일을 만들어 돌려준다.
 */
export const claudeAgentTranslator: AgentDefinitionTranslator = {
  translate: () => []
}
