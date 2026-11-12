import type { Report } from '../../shared/report'
import { asString, firstHeading, splitFrontmatter } from './markdown'
import { REPORT_ID } from './ids'

export function parseReport(fileName: string, text: string): Report {
  const id = fileName.replace(/\.md$/, '')
  if (!REPORT_ID.test(id)) throw new Error('파일명이 허용 형식이 아닙니다.')
  const { data, body } = splitFrontmatter(text)
  const title =
    asString(data.title) ?? firstHeading(body)?.replace(/^보고서\s*[:：]\s*/, '') ?? null
  if (!title) throw new Error('제목(# 제목)을 찾을 수 없습니다.')
  const ticketId = /\bT-\d{1,6}\b/.exec(id)?.[0] ?? /\bT-\d{1,6}\b/.exec(title)?.[0] ?? null
  return { id, title, ticketId, body }
}
