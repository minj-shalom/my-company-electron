/**
 * stdout 청크를 줄 단위로 모은다. 청크 경계에서 잘린 줄은 다음 청크와 합친다.
 * 호출 측은 `setEncoding('utf8')`로 디코딩한 문자열을 넘긴다 (멀티바이트 문자가 경계에서 깨지지 않게).
 */
export class LineBuffer {
  private rest = ''

  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split('\n')
    this.rest = parts.pop() ?? ''
    return parts.map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '')
  }

  /** 스트림 종료 시 개행 없이 끝난 마지막 줄을 꺼낸다. */
  flush(): string[] {
    const last = this.rest.trim()
    this.rest = ''
    return last === '' ? [] : [last]
  }
}
