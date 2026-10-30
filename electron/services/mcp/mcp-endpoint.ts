import type { IncomingMessage, ServerResponse } from 'http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult
} from '@modelcontextprotocol/sdk/types.js'
import { BRAND } from '@shared/brand'
import { isRefusal } from '@shared/refusal'
import { mcpRouteRequest, type McpRouteRequest, type McpToolDefinition } from './mcp-tools'

/**
 * The Streamable HTTP MCP endpoint (D39) on the automation server, one per
 * project at `/automation/<projectId>/mcp`, behind the project's automation
 * token. Stateless: every POST gets a fresh MCP server with the project's
 * tools, so nothing is kept between requests and nothing outlives the API.
 */

/** What a route answered when a tool ran it in-process. */
export interface CapturedRouteResponse {
  status: number
  contentType: string
  body: Buffer
}

export type InvokeRoute = (request: McpRouteRequest) => Promise<CapturedRouteResponse>

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]'])
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Why an MCP request is refused before it reaches the token check, or null.
 * Against DNS rebinding a page in a browser could otherwise reach the
 * endpoint by a name that resolves to 127.0.0.1: the `Host` must be a loopback
 * name with the automation port, and an `Origin`, when sent, a loopback one.
 */
export function mcpRequestRefusal(req: IncomingMessage, port: number | null): string | null {
  const remote = req.socket?.remoteAddress ?? ''
  if (!LOOPBACK_ADDRESSES.has(remote)) return 'Only this computer may connect'
  const host = (req.headers.host ?? '').toLowerCase()
  if (port === null || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`))
    return 'The Host header must be 127.0.0.1 or localhost with the automation API port'
  const origin = req.headers.origin
  if (origin !== undefined) {
    let hostname = ''
    try {
      const url = new URL(origin)
      if (url.protocol === 'http:' || url.protocol === 'https:') hostname = url.hostname
    } catch {
      hostname = ''
    }
    if (!LOOPBACK_HOSTNAMES.has(hostname)) return 'Requests from a web page are refused'
  }
  return null
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-ndjson))|\+json|\+xml/

/** A route's answer as a tool result: a refusal is an MCP tool error with the API's message. */
export function toolResult(
  response: CapturedRouteResponse,
  uri: string,
  maximumFileBytes: number
): CallToolResult {
  const contentType = response.contentType.split(';')[0].trim().toLowerCase()
  if (contentType === 'application/json') {
    let payload: unknown
    try {
      payload = JSON.parse(response.body.toString('utf8'))
    } catch {
      payload = null
    }
    const envelope = (payload ?? {}) as { ok?: unknown; value?: unknown; error?: unknown }
    if (response.status >= 400 || envelope.ok !== true) {
      const rest: Record<string, unknown> = { ...envelope }
      const error = rest.error
      delete rest.ok
      delete rest.error
      const message = typeof error === 'string' ? error : `Request failed (${response.status})`
      const details = Object.keys(rest).length > 0 ? `\n${JSON.stringify(rest)}` : ''
      return { isError: true, content: [{ type: 'text', text: `${message}${details}` }] }
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(envelope.value ?? null, null, 2) }]
    }
  }
  if (response.status >= 400) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Request failed (${response.status})` }]
    }
  }
  if (TEXT_TYPES.test(contentType)) {
    return { content: [{ type: 'text', text: response.body.toString('utf8') }] }
  }
  if (response.body.length > maximumFileBytes) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `The file is ${response.body.length} bytes, more than a tool result carries. Fetch it from the automation API instead.`
        }
      ]
    }
  }
  const data = response.body.toString('base64')
  if (contentType.startsWith('image/')) {
    return { content: [{ type: 'image', data, mimeType: contentType }] }
  }
  return {
    content: [
      { type: 'resource', resource: { uri, mimeType: contentType || undefined, blob: data } }
    ]
  }
}

export interface McpServerOptions {
  projectId: string
  tools: readonly McpToolDefinition[]
  invoke: InvokeRoute
  version: string
  maximumFileBytes: number
}

/** The MCP server for one project: tools only (D39), no prompts, sampling or resources. */
export function createMcpServer(options: McpServerOptions): Server {
  const server = new Server(
    { name: BRAND.fullName, version: options.version },
    {
      capabilities: { tools: {} },
      instructions:
        `${BRAND.fullName} project ${options.projectId}. Each tool is one route of the ` +
        `${BRAND.name} automation API and acts for the person who connected you, with the rights ` +
        'of their automation token: plan tasks, milestones, goals and blockers, read and file ' +
        'Library items, and read reports. IDs are opaque strings returned by earlier calls; ' +
        'never invent one. A refused call returns its reason: relay it rather than retrying blindly.'
    }
  )
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]))
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: options.tools.map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema,
      annotations: { ...annotations, title }
    }))
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name)
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`)
    let routeRequest: McpRouteRequest
    try {
      routeRequest = mcpRouteRequest(tool, request.params.arguments)
    } catch (error) {
      if (!isRefusal(error)) throw error
      return { isError: true, content: [{ type: 'text', text: error.message }] }
    }
    const response = await options.invoke(routeRequest)
    const uri = `ostler-automation://${options.projectId}${routeRequest.path}`
    return toolResult(response, uri, options.maximumFileBytes)
  })
  return server
}

/** Answers one HTTP request to the endpoint with a fresh, stateless MCP server. */
export async function serveMcpHttp(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  server: Server
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}
