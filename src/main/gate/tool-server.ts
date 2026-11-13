import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  GATE_SERVER_NAME,
  GATE_TOOL_NAMES,
  type GateResult,
  type GateToolName
} from '../../shared/gate'

const MAX_BODY = 16 * 1024
const DEFAULT_PROTOCOL = '2025-03-26'

const TOOLS: Record<GateToolName, { description: string; inputSchema: object }> = {
  gate_push: {
    description:
      '브랜치를 원격에 푸시한다. 정책에 따라 컨펌 카드만 남기거나 자동 실행한다. branch를 생략하면 현재 브랜치.',
    inputSchema: {
      type: 'object',
      properties: { branch: { type: 'string', maxLength: 200 } },
      additionalProperties: false
    }
  },
  gate_merge: {
    description:
      'PR을 머지한다. 정책에 따라 컨펌 카드만 남기거나 자동 실행한다. 검수(reviewer-qa) 통과 기록이 필요하다.',
    inputSchema: {
      type: 'object',
      properties: { pr: { type: 'integer', minimum: 1 } },
      required: ['pr'],
      additionalProperties: false
    }
  },
  gate_publish: {
    description:
      '초안을 발행한다. draft는 산출물 폴더 기준 .md 경로. 정책에 따라 컨펌 카드만 남기거나 자동 실행한다.',
    inputSchema: {
      type: 'object',
      properties: { draft: { type: 'string', maxLength: 200 } },
      required: ['draft'],
      additionalProperties: false
    }
  }
}

export interface ToolServer {
  url: string
  /** 이 실행만 쓰는 일회용 비밀. 설정 파일에만 쓰고 로그·결과에 넣지 않는다 (외부 자격 증명이 아니다). */
  token: string
  close(): Promise<void>
}

export interface ToolServerOptions {
  call: (tool: GateToolName, input: unknown) => Promise<GateResult>
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text)
  })
  res.end(text)
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    const b = c as Buffer
    size += b.length
    if (size > MAX_BODY) return null
    chunks.push(b)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 실행마다 띄우는 최소 MCP(streamable HTTP, JSON 응답) 도구 서버. 127.0.0.1에만 바인딩하고
 * Bearer 토큰, Host/Origin 검사로 같은 기계의 다른 프로세스나 웹 페이지가 호출하지 못하게 한다.
 * 도구는 게이트 3종뿐이고 호출 직원·프로젝트·티켓은 서버를 만든 쪽이 고정한다 (도구 입력으로 바꿀 수 없다).
 */
export async function startToolServer(opts: ToolServerOptions): Promise<ToolServer> {
  const token = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  let port = 0

  const authorized = (req: IncomingMessage): boolean => {
    const got = Buffer.from(req.headers.authorization ?? '')
    return got.length === expected.length && timingSafeEqual(got, expected)
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      // 거부 응답 전에 본문을 비워야 연결 재사용 때 클라이언트가 끊기지 않는다.
      const deny = (status: number): void => {
        req.resume()
        send(res, status)
      }
      const host = req.headers.host
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return deny(403)
      if (req.headers.origin !== undefined) return deny(403)
      if (!authorized(req)) return deny(401)
      if (req.method !== 'POST' || req.url !== '/mcp') return deny(405)
      const text = await readBody(req)
      if (text === null) return send(res, 413)
      let msg: unknown
      try {
        msg = JSON.parse(text)
      } catch {
        return send(res, 400)
      }
      if (!isRecord(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
        return send(res, 400)
      const id = msg.id
      if (id === undefined) return send(res, 202)
      const reply = (result: unknown): void => send(res, 200, { jsonrpc: '2.0', id, result })
      const error = (code: number, message: string): void =>
        send(res, 200, { jsonrpc: '2.0', id, error: { code, message } })
      const params = isRecord(msg.params) ? msg.params : {}
      switch (msg.method) {
        case 'initialize':
          return reply({
            protocolVersion:
              typeof params.protocolVersion === 'string'
                ? params.protocolVersion
                : DEFAULT_PROTOCOL,
            capabilities: { tools: {} },
            serverInfo: { name: GATE_SERVER_NAME, version: '1' }
          })
        case 'ping':
          return reply({})
        case 'tools/list':
          return reply({
            tools: GATE_TOOL_NAMES.map((name) => ({ name, ...TOOLS[name] }))
          })
        case 'tools/call': {
          const name = params.name
          if (typeof name !== 'string' || !GATE_TOOL_NAMES.includes(name as GateToolName))
            return error(-32602, 'Unknown tool')
          // 결과에는 게이트가 만든 고정 문장만 담는다 (경로, 환경변수, 자격 증명 값 없음).
          const r = await opts
            .call(name as GateToolName, params.arguments ?? {})
            .catch((): GateResult => ({
              status: 'failed',
              message: '게이트 처리 중 오류가 났습니다.'
            }))
          return reply({
            content: [{ type: 'text', text: r.message }],
            isError: r.status === 'failed' || r.status === 'blocked'
          })
        }
        default:
          return error(-32601, 'Method not found')
      }
    })().catch(() => {
      if (!res.headersSent) send(res, 500)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
