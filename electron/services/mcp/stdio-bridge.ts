import { readFileSync } from 'fs'
import { join } from 'path'
import type { Readable, Writable } from 'stream'
import { BRAND } from '@shared/brand'

/**
 * The stdio launcher (D39): `<Ostler> --mcp-stdio --project <id>`. An MCP
 * client starts it as a command and talks over stdin and stdout; it reads the
 * automation port and the project's token from the data folder and forwards
 * each message to the running Ostler's endpoint, so the token never goes into
 * the client's configuration. It opens no window, takes no lock, starts no
 * service and never opens the database: it reads `config.json` and nothing
 * else. The token is stored encrypted, so the caller passes the one function
 * that opens it (`openSecret` in the launcher). Nothing here imports
 * Electron, so the tests run it as it is.
 */

export const MCP_STDIO_FLAG = '--mcp-stdio'
const PROJECT_FLAG = '--project'

/** The project a launch asks for, null when it is not the launcher, or an error to report. */
export function mcpStdioRequest(
  argv: readonly string[]
): { projectId: string } | { error: string } | null {
  if (!argv.includes(MCP_STDIO_FLAG)) return null
  const index = argv.findIndex((arg) => arg === PROJECT_FLAG || arg.startsWith(`${PROJECT_FLAG}=`))
  const projectId =
    index === -1
      ? ''
      : argv[index].startsWith(`${PROJECT_FLAG}=`)
        ? argv[index].slice(PROJECT_FLAG.length + 1)
        : (argv[index + 1] ?? '')
  if (!projectId || projectId.startsWith('--'))
    return { error: `Start it as ${MCP_STDIO_FLAG} ${PROJECT_FLAG} <project id>` }
  return { projectId }
}

/** Where the launcher sends a project's messages, or why it cannot. */
export type BridgeTarget = { url: string; token: string } | { error: string }

/**
 * Reads the port and the project's token from `<dataDir>/config.json` as it
 * is now, so turning the API on, or a new token, works without restarting
 * the client. `openSecret` decrypts the stored token, and throws when it cannot.
 */
export function readBridgeTarget(
  dataDir: string,
  projectId: string,
  openSecret: (stored: string) => string
): BridgeTarget {
  let config: {
    automationApi?: { enabled?: unknown; port?: unknown }
    projects?: Array<{ id?: unknown; automationToken?: unknown }>
  }
  try {
    config = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8'))
  } catch {
    return { error: `${BRAND.name} has no settings in ${dataDir}. Start ${BRAND.name} first.` }
  }
  const api = config.automationApi ?? {}
  if (api.enabled !== true || typeof api.port !== 'number')
    return {
      error: `The automation API is off. Turn it on in ${BRAND.name}: Settings › Connections.`
    }
  const project = (config.projects ?? []).find((entry) => entry.id === projectId)
  if (!project) return { error: `${BRAND.name} has no project with the id ${projectId}.` }
  if (typeof project.automationToken !== 'string' || project.automationToken === '')
    return {
      error: `The project has no automation token. Create one in ${BRAND.name}: Settings › Connections.`
    }
  let token: string
  try {
    token = openSecret(project.automationToken)
  } catch {
    return {
      error: `The project's automation token could not be decrypted on this computer. Create a new one in ${BRAND.name}: Settings � Connections.`
    }
  }
  return {
    url: `http://127.0.0.1:${api.port}/automation/${encodeURIComponent(projectId)}/mcp`,
    token
  }
}

type JsonRpcMessage = { jsonrpc?: unknown; id?: unknown; method?: unknown }

const isRequest = (message: JsonRpcMessage): boolean =>
  typeof message.method === 'string' && message.id !== undefined && message.id !== null

function errorFor(message: JsonRpcMessage, text: string): unknown {
  return { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: text } }
}

/** The messages in an endpoint's answer: JSON, or the data lines of an event stream. */
function messagesIn(contentType: string, text: string): unknown[] {
  if (!text.trim()) return []
  if (contentType.includes('text/event-stream')) {
    return text
      .split(/\r?\n\r?\n/)
      .map((event) =>
        event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
      )
      .filter((data) => data !== '')
      .flatMap((data) => {
        const value: unknown = JSON.parse(data)
        return Array.isArray(value) ? value : [value]
      })
  }
  const value: unknown = JSON.parse(text)
  return Array.isArray(value) ? value : [value]
}

export interface BridgeOptions {
  input: Readable
  output: Writable
  /** The target for each message, read afresh. */
  target: () => BridgeTarget
  fetch?: typeof fetch
}

/**
 * Forwards newline-delimited JSON-RPC from `input` to the endpoint, each
 * message as it comes, and writes each answer to `output`. A request that
 * cannot reach Ostler is answered with an MCP error saying why; a
 * notification that cannot is dropped, as it has no answer. Resolves when
 * `input` ends.
 */
export async function runStdioBridge(options: BridgeOptions): Promise<void> {
  const send = options.fetch ?? fetch
  const write = (message: unknown) => options.output.write(`${JSON.stringify(message)}\n`)

  const forward = async (line: string): Promise<void> => {
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    const target = options.target()
    if ('error' in target) {
      if (isRequest(message)) write(errorFor(message, target.error))
      return
    }
    let response: Response
    try {
      response = await send(target.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${target.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-06-18'
        },
        body: line
      })
    } catch {
      if (isRequest(message))
        write(
          errorFor(
            message,
            `${BRAND.name} is not running, or its automation API is not listening. Start ${BRAND.name} and turn the automation API on in Settings › Connections.`
          )
        )
      return
    }
    const text = await response.text()
    let answers: unknown[]
    try {
      answers = messagesIn(response.headers.get('content-type') ?? '', text)
    } catch {
      answers = []
    }
    // A refusal before MCP (a token, Host or Origin) is a plain API error.
    const refused = answers.length === 0 || !('jsonrpc' in (answers[0] as object))
    if (!response.ok && refused) {
      let reason = `${BRAND.name} refused the connection (${response.status})`
      try {
        const body = JSON.parse(text) as { error?: unknown }
        if (typeof body.error === 'string') reason = `${reason}: ${body.error}`
      } catch {
        // Not JSON: the status says enough.
      }
      if (isRequest(message)) write(errorFor(message, reason))
      return
    }
    for (const answer of answers) write(answer)
  }

  let buffered = ''
  const pending: Promise<void>[] = []
  options.input.setEncoding('utf8')
  await new Promise<void>((resolve, reject) => {
    options.input.on('data', (chunk: string) => {
      buffered += chunk
      let newline = buffered.indexOf('\n')
      while (newline !== -1) {
        const line = buffered.slice(0, newline).replace(/\r$/, '')
        buffered = buffered.slice(newline + 1)
        if (line.trim()) pending.push(forward(line))
        newline = buffered.indexOf('\n')
      }
    })
    options.input.on('end', () => {
      if (buffered.trim()) pending.push(forward(buffered))
      Promise.all(pending).then(() => resolve(), reject)
    })
    options.input.on('error', reject)
  })
}
