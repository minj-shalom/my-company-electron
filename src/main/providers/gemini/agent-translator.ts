import type { AgentDefinition, AgentDefinitionTranslator, TranslatedAgentFile } from '../types'

const HEADER = [
  '# AI 직원 지침 (자동 생성)',
  '',
  '이 파일은 `.claude/agents/*.md`의 직원 정의에서 생성된다. 직접 수정하지 말고 원본을 고친다.',
  '작업을 맡으면 요청에 맞는 직원의 역할과 지침을 따른다.'
].join('\n')

/** 이름은 한 줄이어야 한다. 줄바꿈·제어 문자는 공백으로 바꿔 제목 구조를 깨지 못하게 한다. */
function oneLine(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
}

/**
 * Gemini CLI는 작업 디렉터리의 `GEMINI.md`를 지침(컨텍스트) 파일로 읽는다. 서브에이전트 개념이 없어서
 * 직원마다 한 절로 이어 붙인다. 도구·모델 필드는 제공자 중립이 아니므로 참고 줄로만 남긴다.
 */
export const geminiAgentTranslator: AgentDefinitionTranslator = {
  translate(agents: readonly AgentDefinition[]): TranslatedAgentFile[] {
    if (agents.length === 0) return []
    const sections = agents.map((a) => {
      const lines = [`## ${oneLine(a.name)}`, '', `역할: ${oneLine(a.description)}`]
      if (a.tools && a.tools.length > 0) lines.push(`참고 도구: ${a.tools.map(oneLine).join(', ')}`)
      lines.push('', a.prompt.trim())
      return lines.join('\n')
    })
    return [{ relativePath: 'GEMINI.md', content: `${HEADER}\n\n${sections.join('\n\n')}\n` }]
  }
}
