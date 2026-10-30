import { randomUUID } from 'node:crypto'

import {
  AI_EFFORT_LEVELS,
  imagesAsDescriptionsWarning,
  type AIEffortLevel,
  type AIModelEffortSupport,
  type AIProvider
} from '@shared/ostler-api'
import { logAiCall } from './ai-call-logger'
import {
  parseSseJson,
  REQUEST_START_TIMEOUT_MS,
  streamSse,
  withProviderStream,
  type ProviderStream
} from './ai-stream'
import { t } from '@shared/i18n'

/**
 * One part of a multimodal message. Image parts stay in the main process:
 * they are built from library vision copies and never cross IPC.
 * `description` (title, summary and caption) is what replaces the image when
 * the model cannot read it.
 */
export type AIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; base64: string; description?: string }

/** What every chat request carries. `effort` is left out unless one is set. */
export interface AIRequestOptions {
  model: string
  maxTokens: number
  temperature: number
  stream: boolean
  effort?: AIEffortLevel
}

export interface AIChatMessage {
  role: string
  content: string | AIContentPart[]
}

/** A message's text parts joined; image parts contribute nothing. */
export function messageText(content: AIChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content
    .filter((part): part is Extract<AIContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
}

export function hasImageParts(messages: AIChatMessage[]): boolean {
  return messages.some(
    (message) =>
      typeof message.content !== 'string' && message.content.some((part) => part.type === 'image')
  )
}

/** The text line an image becomes when the model cannot read it. */
function imageAsText(part: Extract<AIContentPart, { type: 'image' }>): string {
  return `[Image sent as a description] ${part.description?.trim() || `(${part.mimeType} image)`}`
}

/**
 * Every image part replaced by its text line. A message left with only text
 * becomes a plain string again, so the request is exactly what a text-only
 * call would send.
 */
export function imagesAsDescriptions(messages: AIChatMessage[]): AIChatMessage[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') return message
    return {
      role: message.role,
      content: messageText(
        message.content.map((part) =>
          part.type === 'image' ? { type: 'text' as const, text: imageAsText(part) } : part
        )
      )
    }
  })
}

function dataUrl(part: Extract<AIContentPart, { type: 'image' }>): string {
  return `data:${part.mimeType};base64,${part.base64}`
}

function toOpenAIChatMessage(message: AIChatMessage): { role: string; content: unknown } {
  if (typeof message.content === 'string') return { role: message.role, content: message.content }
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'image_url', image_url: { url: dataUrl(part) } }
    )
  }
}

function toAnthropicMessage(message: AIChatMessage): { role: string; content: unknown } {
  if (typeof message.content === 'string') return { role: message.role, content: message.content }
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : {
            type: 'image',
            source: { type: 'base64', media_type: part.mimeType, data: part.base64 }
          }
    )
  }
}

function toGoogleParts(content: AIChatMessage['content']): unknown[] {
  if (typeof content === 'string') return [{ text: content }]
  return content.map((part) =>
    part.type === 'text'
      ? { text: part.text }
      : { inlineData: { mimeType: part.mimeType, data: part.base64 } }
  )
}

/** A provider error that reads as "this request's images were refused". */
const IMAGE_REJECTION =
  /image|vision|multimodal|multi-modal|image_url|input_image|inline_?data|media[_ ]type|unsupported content/i

/** Whether a provider error says the request's images were refused (a 4xx naming images). */
export function isImageRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /API error: 4\d\d/.test(message) && IMAGE_REJECTION.test(message)
}

/**
 * Sends a chat that may carry images, honouring the vision setting. When
 * vision is off, or the provider rejects the request because of an image
 * before any text arrived, every image part becomes a text line and the
 * request is retried once; `onWarning` then receives the UI note.
 */
export async function* chatWithImageFallback(
  provider: AIProviderInterface,
  messages: AIChatMessage[],
  options: AIRequestOptions,
  { vision, onWarning }: { vision: boolean; onWarning?: (warning: string) => void }
): AsyncGenerator<string, void, unknown> {
  if (!hasImageParts(messages)) {
    yield* provider.chat(messages, options)
    return
  }
  if (!vision) {
    onWarning?.(imagesAsDescriptionsWarning())
    yield* provider.chat(imagesAsDescriptions(messages), options)
    return
  }
  let yielded = false
  try {
    for await (const chunk of provider.chat(messages, options)) {
      yielded = true
      yield chunk
    }
    return
  } catch (error) {
    if (yielded || !isImageRefusal(error)) throw error
  }
  onWarning?.(imagesAsDescriptionsWarning())
  yield* provider.chat(imagesAsDescriptions(messages), options)
}

export interface AIProviderInterface {
  chat(messages: AIChatMessage[], options: AIRequestOptions): AsyncGenerator<string, void, unknown>
  /** A one-word request; with `effort`, the same request at that level. */
  testConnection(
    model: string,
    effort?: AIEffortLevel
  ): Promise<{ model: string; responseMs: number }>
}

/**
 * The emergency-stop switch for every model request Ostler makes. Every
 * provider call goes through `aiFetch`, which listens to the current
 * controller, so aborting it cancels requests that are waiting for a response
 * and streams that are mid-reply alike. It is replaced straight after firing so
 * requests made afterwards are unaffected.
 */
let emergencyStop = new AbortController()

/** Cancels every in-flight AI request, with a reason the caller's error will carry. */
export function abortAllAiRequests(): void {
  const current = emergencyStop
  emergencyStop = new AbortController()
  current.abort(new Error(t('errors:aiProvider.stoppedEmergencyStop')))
}

/**
 * Model requests waiting for a response, for the status bar's "AI busy". A
 * request counts until its response arrives: a non-streamed reply arrives
 * whole, and a streamed one is visible where it is streaming.
 */
let activeAiRequests = 0
let aiActivityListener: ((activeRequests: number) => void) | null = null

/** How many model requests are waiting for a response right now. */
export function activeAiRequestCount(): number {
  return activeAiRequests
}

/** Called whenever `activeAiRequestCount` changes. */
export function setAiActivityListener(listener: ((activeRequests: number) => void) | null): void {
  aiActivityListener = listener
}

function changeAiActivity(delta: number): void {
  activeAiRequests = Math.max(0, activeAiRequests + delta)
  try {
    aiActivityListener?.(activeAiRequests)
  } catch (error) {
    console.error('AI activity listener failed:', error)
  }
}

async function aiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const signals = init.signal ? [emergencyStop.signal, init.signal] : [emergencyStop.signal]
  changeAiActivity(1)
  try {
    return await fetch(input, { ...init, signal: AbortSignal.any(signals) })
  } finally {
    changeAiActivity(-1)
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function normalizeProviderBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/(?:chat\/completions|responses|messages)$/i, '')
}

function providerEndpointUrl(baseUrl: string, endpoint: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const suffix = `/${endpoint}`
  return normalized.toLowerCase().endsWith(suffix.toLowerCase())
    ? normalized
    : `${normalized}${suffix}`
}

const OPEN_CODE_GO_RESPONSES_MODELS = new Set([
  'grok-4.5',
  'gpt-5.6-luna',
  'muse-spark-1.2-contributor'
])

const OPEN_CODE_GO_MESSAGES_MODELS = new Set([
  'minimax-m3',
  'minimax-m2.7',
  'minimax-m2.5',
  'qwen3.8-max',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
  'qwen3.5-plus'
])

const OPEN_CODE_ZEN_RESPONSES_MODELS = new Set([
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5',
  'gpt-5-codex',
  'gpt-5-nano',
  'grok-4.6',
  'grok-4.5',
  'grok-build-0.1',
  'muse-spark-1.2',
  'muse-spark-1.2-contributor-free'
])

/**
 * OpenCode Zen serves every Anthropic model through its messages endpoint
 * (Zen's model table lists each `claude-*` id under `/v1/messages`), so the
 * whole family routes there and a new Claude release needs no entry here.
 */
const OPEN_CODE_ZEN_MESSAGES_FAMILIES = /^claude-/

/** Zen models outside a certain family that also use the messages endpoint. */
const OPEN_CODE_ZEN_MESSAGES_MODELS = new Set([
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
  'qwen3.5-plus'
])

const OPENAI_RESPONSES_MODELS = new Set([
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.6',
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5',
  'gpt-5-codex',
  'gpt-5-nano'
])

function isOpenCodeBaseUrl(baseUrl: string): boolean {
  const normalized = normalizeProviderBaseUrl(baseUrl).toLowerCase()
  return (
    normalized === 'https://opencode.ai/zen/go/v1' || normalized === 'https://opencode.ai/zen/v1'
  )
}

/**
 * OpenCode's zen gateways reject requests that carry no `x-opencode-session`,
 * which they use to route a conversation consistently and to keep prompt
 * caching warm across its turns. Callers that own a conversation should pass
 * its id; everything else shares one stable per-process id so the request is
 * still accepted.
 */
const processOpenCodeSessionId = `ostler-${randomUUID()}`

export function openCodeSessionHeaders(
  baseUrl: string,
  sessionId?: string
): Record<string, string> {
  if (!isOpenCodeBaseUrl(baseUrl)) return {}
  const trimmed = sessionId?.trim()
  return { 'x-opencode-session': trimmed || processOpenCodeSessionId }
}

function normalizeOpenCodeModelId(baseUrl: string, model: string): string {
  const normalizedModel = model.trim()
  if (!isOpenCodeBaseUrl(baseUrl)) return normalizedModel

  return normalizedModel.replace(/^opencode(?:-go)?\//i, '')
}

/**
 * Model families that only ever speak the Responses protocol. Matching the
 * family rather than each id keeps a new release (muse-spark-1.3-contributor)
 * from falling through to chat/completions, which rejects it with
 * "Model does not support this protocol" -- the exact-id sets above only know
 * models that existed when they were written, and the Settings model refresh
 * now surfaces ones they do not.
 */
const OPEN_CODE_RESPONSES_FAMILIES = /^muse-spark-/

function usesOpenCodeResponses(baseUrl: string, model: string): boolean {
  const normalizedBaseUrl = normalizeProviderBaseUrl(baseUrl).toLowerCase()
  const normalizedModel = normalizeOpenCodeModelId(baseUrl, model)

  if (normalizedBaseUrl === 'https://opencode.ai/zen/go/v1') {
    return (
      OPEN_CODE_GO_RESPONSES_MODELS.has(normalizedModel) ||
      OPEN_CODE_RESPONSES_FAMILIES.test(normalizedModel)
    )
  }

  if (normalizedBaseUrl === 'https://opencode.ai/zen/v1') {
    return (
      OPEN_CODE_ZEN_RESPONSES_MODELS.has(normalizedModel) ||
      OPEN_CODE_RESPONSES_FAMILIES.test(normalizedModel)
    )
  }

  return false
}

function usesOpenCodeMessages(baseUrl: string, model: string): boolean {
  const normalizedBaseUrl = normalizeProviderBaseUrl(baseUrl).toLowerCase()
  const normalizedModel = normalizeOpenCodeModelId(baseUrl, model)

  if (normalizedBaseUrl === 'https://opencode.ai/zen/go/v1') {
    return OPEN_CODE_GO_MESSAGES_MODELS.has(normalizedModel)
  }

  if (normalizedBaseUrl === 'https://opencode.ai/zen/v1') {
    return (
      OPEN_CODE_ZEN_MESSAGES_MODELS.has(normalizedModel) ||
      OPEN_CODE_ZEN_MESSAGES_FAMILIES.test(normalizedModel)
    )
  }

  return false
}

function usesOpenAIResponses(baseUrl: string, model: string): boolean {
  return (
    normalizeProviderBaseUrl(baseUrl).toLowerCase() === 'https://api.openai.com/v1' &&
    OPENAI_RESPONSES_MODELS.has(model.trim())
  )
}

/** Which wire format a "custom" provider endpoint speaks for a given model, reusing the exact same detection this module already relies on for direct chat calls so the embedded harness classifies a model identically to everything else. */
export type CustomProviderEndpointStyle = 'chat-completions' | 'responses' | 'messages'

export function resolveCustomProviderEndpointStyle(
  baseUrl: string,
  model: string
): CustomProviderEndpointStyle {
  if (usesOpenCodeResponses(baseUrl, model) || usesOpenAIResponses(baseUrl, model))
    return 'responses'
  if (usesOpenCodeMessages(baseUrl, model)) return 'messages'
  return 'chat-completions'
}

/** Strips an `opencode`/`opencode-go` prefix from a model id when baseUrl is one of OpenCode's own zen endpoints, matching normalizeOpenCodeModelId's behavior for direct calls. */
export function resolveCustomProviderModelId(baseUrl: string, model: string): string {
  return normalizeOpenCodeModelId(baseUrl, model)
}

/**
 * The OpenAI-style key header, or none at all without a key: a keyless local
 * server (Ollama, LM Studio) is sent no Authorization header (P7.1).
 */
export function bearerHeader(apiKey: string): Record<string, string> {
  const key = apiKey.trim()
  return key ? { Authorization: `Bearer ${key}` } : {}
}

async function throwProviderError(
  response: Response,
  providerName: string,
  context?: { endpoint: string; model: string }
): Promise<never> {
  let detail = ''
  try {
    const body = await response.text()
    if (body) {
      try {
        const parsed = JSON.parse(body) as {
          error?: { message?: string } | string
          message?: string
        }
        if (typeof parsed.error === 'string') detail = parsed.error
        else if (parsed.error?.message) detail = parsed.error.message
        else if (parsed.message) detail = parsed.message
      } catch {
        detail = body.slice(0, 240)
      }
    }
  } catch {
    // Keep the status error when the provider response body cannot be read.
  }

  throw new Error(
    `${providerName} API error: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}${context ? ` [endpoint: ${context.endpoint}; model: ${context.model}]` : ''}`
  )
}

/**
 * Sends one streamed request under the stream's watchdog and records its
 * status; a refusal throws with the provider's own words.
 */
async function openStream(
  stream: ProviderStream,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  provider: string,
  context?: Parameters<typeof throwProviderError>[2]
): Promise<Response> {
  const res = await aiFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: stream.watchdog.signal
  })
  stream.status = res.status
  stream.watchdog.keepAlive()
  if (!res.ok) await throwProviderError(res, provider, context)
  return res
}

export class OpenAICompatibleProvider implements AIProviderInterface {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private providerName = 'OpenAI',
    private sessionId?: string
  ) {}

  async *chat(
    messages: AIChatMessage[],
    options: AIRequestOptions
  ): AsyncGenerator<string, void, unknown> {
    const requestModel = normalizeOpenCodeModelId(this.baseUrl, options.model)
    const requestBody = {
      messages: messages.map(toOpenAIChatMessage),
      model: requestModel,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      ...chatCompletionsEffort(this.baseUrl, options.effort),
      stream: options.stream
    }
    yield* withProviderStream(
      this.providerName,
      {
        kind: 'openai-compatible',
        provider: this.providerName,
        baseUrl: this.baseUrl,
        model: requestModel,
        endpoint: 'chat/completions',
        request: requestBody
      },
      (stream) => this.chatInner(requestBody, requestModel, stream)
    )
  }

  private async *chatInner(
    requestBody: Record<string, unknown>,
    requestModel: string,
    stream: ProviderStream
  ): AsyncGenerator<string, void, unknown> {
    const res = await openStream(
      stream,
      providerEndpointUrl(this.baseUrl, 'chat/completions'),
      {
        'Content-Type': 'application/json',
        ...bearerHeader(this.apiKey),
        ...openCodeSessionHeaders(this.baseUrl, this.sessionId)
      },
      requestBody,
      this.providerName,
      { endpoint: 'chat/completions', model: requestModel }
    )
    for await (const { data } of streamSse(res, stream.watchdog)) {
      const parsed = parseSseJson<{ choices?: { delta?: { content?: string } }[] }>(data)
      const content = parsed?.choices?.[0]?.delta?.content
      if (content) yield content
    }
  }

  async testConnection(
    model: string,
    effort?: AIEffortLevel
  ): Promise<{ model: string; responseMs: number }> {
    const start = Date.now()
    const requestModel = normalizeOpenCodeModelId(this.baseUrl, model)
    const requestBody = {
      messages: [{ role: 'user', content: 'hello' }],
      model: requestModel,
      max_tokens: 10,
      temperature: 0,
      ...chatCompletionsEffort(this.baseUrl, effort),
      stream: false
    }
    try {
      const res = await aiFetch(providerEndpointUrl(this.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...bearerHeader(this.apiKey),
          ...openCodeSessionHeaders(this.baseUrl, this.sessionId)
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(REQUEST_START_TIMEOUT_MS)
      })

      if (!res.ok) {
        await throwProviderError(res, this.providerName, {
          endpoint: 'chat/completions',
          model: requestModel
        })
      }
      logAiCall({
        kind: 'openai-compatible-test-connection',
        provider: this.providerName,
        baseUrl: this.baseUrl,
        model: requestModel,
        endpoint: 'chat/completions',
        request: requestBody,
        responseStatus: res.status,
        durationMs: Date.now() - start
      })
      return { model, responseMs: Date.now() - start }
    } catch (error) {
      logAiCall({
        kind: 'openai-compatible-test-connection',
        provider: this.providerName,
        baseUrl: this.baseUrl,
        model: requestModel,
        endpoint: 'chat/completions',
        request: requestBody,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start
      })
      throw error
    }
  }
}

/** Provider for OpenAI Responses-compatible endpoints such as OpenCode Go. */
export class OpenAIResponsesProvider implements AIProviderInterface {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private providerName = 'OpenAI Responses',
    private sessionId?: string
  ) {}

  private inputFromMessages(messages: AIChatMessage[]) {
    const textType = (role: string) => (role === 'assistant' ? 'output_text' : 'input_text')
    return messages.map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string'
          ? [{ type: textType(message.role), text: message.content }]
          : message.content.map((part) =>
              part.type === 'text'
                ? { type: textType(message.role), text: part.text }
                : { type: 'input_image', image_url: dataUrl(part) }
            )
    }))
  }

  async *chat(
    messages: AIChatMessage[],
    options: AIRequestOptions
  ): AsyncGenerator<string, void, unknown> {
    const requestModel = normalizeOpenCodeModelId(this.baseUrl, options.model)
    const requestBody = {
      model: requestModel,
      input: this.inputFromMessages(messages),
      max_output_tokens: options.maxTokens,
      temperature: options.temperature,
      ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
      stream: options.stream
    }
    yield* withProviderStream(
      this.providerName,
      {
        kind: 'openai-responses',
        provider: this.providerName,
        baseUrl: this.baseUrl,
        model: requestModel,
        endpoint: 'responses',
        request: requestBody
      },
      (stream) => this.chatInner(requestBody, requestModel, stream)
    )
  }

  private async *chatInner(
    requestBody: Record<string, unknown>,
    requestModel: string,
    stream: ProviderStream
  ): AsyncGenerator<string, void, unknown> {
    const res = await openStream(
      stream,
      providerEndpointUrl(this.baseUrl, 'responses'),
      {
        'Content-Type': 'application/json',
        ...bearerHeader(this.apiKey),
        ...openCodeSessionHeaders(this.baseUrl, this.sessionId)
      },
      requestBody,
      this.providerName,
      { endpoint: 'responses', model: requestModel }
    )
    let emittedDelta = false
    for await (const { data } of streamSse(res, stream.watchdog)) {
      const parsed = parseSseJson<{
        type?: string
        delta?: string
        text?: string
        response?: { output?: Array<{ content?: Array<{ text?: string }> }> }
      }>(data)
      if (!parsed) continue
      if (parsed.type === 'response.output_text.delta' && parsed.delta) {
        emittedDelta = true
        yield parsed.delta
      } else if (!emittedDelta && parsed.type === 'response.output_text.done' && parsed.text) {
        // Some Responses-compatible gateways emit only a completed-text
        // event instead of text deltas.
        yield parsed.text
      } else if (!emittedDelta && parsed.type === 'response.completed') {
        const text = parsed.response?.output
          ?.flatMap((item) => item.content ?? [])
          .map((content) => content.text ?? '')
          .join('')
        if (text) yield text
      }
    }
  }

  async testConnection(
    model: string,
    effort?: AIEffortLevel
  ): Promise<{ model: string; responseMs: number }> {
    const start = Date.now()
    const requestModel = normalizeOpenCodeModelId(this.baseUrl, model)
    const requestBody = {
      model: requestModel,
      ...(effort ? { reasoning: { effort } } : {}),
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'hello' }]
        }
      ],
      max_output_tokens: 16,
      temperature: 0,
      stream: false
    }
    try {
      const res = await aiFetch(providerEndpointUrl(this.baseUrl, 'responses'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...bearerHeader(this.apiKey),
          ...openCodeSessionHeaders(this.baseUrl, this.sessionId)
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(REQUEST_START_TIMEOUT_MS)
      })

      if (!res.ok) {
        await throwProviderError(res, this.providerName, {
          endpoint: 'responses',
          model: requestModel
        })
      }
      logAiCall({
        kind: 'openai-responses-test-connection',
        provider: this.providerName,
        baseUrl: this.baseUrl,
        model: requestModel,
        endpoint: 'responses',
        request: requestBody,
        responseStatus: res.status,
        durationMs: Date.now() - start
      })
      return { model, responseMs: Date.now() - start }
    } catch (error) {
      logAiCall({
        kind: 'openai-responses-test-connection',
        provider: this.providerName,
        baseUrl: this.baseUrl,
        model: requestModel,
        endpoint: 'responses',
        request: requestBody,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start
      })
      throw error
    }
  }
}

/**
 * Whether an Anthropic model still takes a `temperature`. The one place that
 * decides it for every Anthropic request (chat, planning, reviews and the
 * Settings test alike): Claude models from the 4.7 generation on reject it
 * with "`temperature` is deprecated for this model", so it is sent only to the
 * older models known to accept it. Leaving it out is always safe; Anthropic
 * then uses its own default.
 */
export function anthropicAcceptsTemperature(model: string): boolean {
  const id = model.toLowerCase().replace(/^.*\//, '')
  if (/^claude-(instant|2)/.test(id)) return true
  // claude-3-5-sonnet-… (version first) or claude-sonnet-4-5-… (family first).
  const version =
    /^claude-(\d+)(?:-(\d)(?!\d))?-[a-z]/.exec(id) ??
    /^claude-[a-z]+-(\d+)(?:-(\d)(?!\d))?/.exec(id)
  if (!version) return false
  const major = Number(version[1])
  const minor = Number(version[2] ?? 0)
  return major < 4 || (major === 4 && minor <= 6)
}

/** The Anthropic Messages request body, with `temperature` only where the model takes it. */
export function anthropicMessagesBody(
  messages: AIChatMessage[],
  options: AIRequestOptions
): Record<string, unknown> {
  const system = messageText(messages.find((m) => m.role === 'system')?.content ?? '')
  return {
    messages: messages.filter((m) => m.role !== 'system').map(toAnthropicMessage),
    ...(system ? { system } : {}),
    model: options.model,
    max_tokens: options.maxTokens,
    ...(anthropicAcceptsTemperature(options.model) ? { temperature: options.temperature } : {}),
    ...(options.effort ? { output_config: { effort: options.effort } } : {}),
    stream: options.stream
  }
}

export class AnthropicProvider implements AIProviderInterface {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private providerName = 'Anthropic',
    private sessionId?: string
  ) {}

  async *chat(
    messages: AIChatMessage[],
    options: AIRequestOptions
  ): AsyncGenerator<string, void, unknown> {
    const requestModel = normalizeOpenCodeModelId(this.baseUrl, options.model)
    const requestBody = anthropicMessagesBody(messages, { ...options, model: requestModel })
    yield* withProviderStream(
      this.providerName,
      {
        kind: 'anthropic',
        provider: this.providerName,
        baseUrl: this.baseUrl,
        model: requestModel,
        endpoint: 'messages',
        request: requestBody
      },
      (stream) => this.chatInner(requestBody, stream)
    )
  }

  private async *chatInner(
    requestBody: Record<string, unknown>,
    stream: ProviderStream
  ): AsyncGenerator<string, void, unknown> {
    const res = await openStream(
      stream,
      providerEndpointUrl(this.baseUrl, 'messages'),
      {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        ...openCodeSessionHeaders(this.baseUrl, this.sessionId)
      },
      requestBody,
      this.providerName
    )
    // One Anthropic SSE event is an `event:` line followed by a `data:` line.
    // streamSse keeps the name across reads, so a chunk boundary between the
    // two cannot drop the text delta.
    for await (const { event, data } of streamSse(res, stream.watchdog)) {
      if (event !== 'content_block_delta') continue
      const parsed = parseSseJson<{ delta?: { type?: string; text?: string } }>(data)
      if (parsed?.delta?.type === 'text_delta' && parsed.delta.text) yield parsed.delta.text
    }
  }

  async testConnection(
    model: string,
    effort?: AIEffortLevel
  ): Promise<{ model: string; responseMs: number }> {
    const start = Date.now()
    const requestModel = normalizeOpenCodeModelId(this.baseUrl, model)
    const requestBody = anthropicMessagesBody([{ role: 'user', content: 'hello' }], {
      model: requestModel,
      maxTokens: 10,
      temperature: 0,
      stream: false,
      effort
    })
    try {
      const res = await aiFetch(providerEndpointUrl(this.baseUrl, 'messages'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          ...openCodeSessionHeaders(this.baseUrl, this.sessionId)
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(REQUEST_START_TIMEOUT_MS)
      })

      if (!res.ok) await throwProviderError(res, this.providerName)
      logAiCall({
        kind: 'anthropic-test-connection',
        provider: this.providerName,
        baseUrl: this.baseUrl,
        model: requestModel,
        endpoint: 'messages',
        request: requestBody,
        responseStatus: res.status,
        durationMs: Date.now() - start
      })
      return { model, responseMs: Date.now() - start }
    } catch (error) {
      logAiCall({
        kind: 'anthropic-test-connection',
        provider: this.providerName,
        baseUrl: this.baseUrl,
        model: requestModel,
        endpoint: 'messages',
        request: requestBody,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start
      })
      throw error
    }
  }
}

export class GoogleProvider implements AIProviderInterface {
  constructor(
    private baseUrl: string,
    private apiKey: string
  ) {}

  async *chat(
    messages: AIChatMessage[],
    options: AIRequestOptions
  ): AsyncGenerator<string, void, unknown> {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: toGoogleParts(m.content)
    }))
    const requestBody = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens,
        temperature: options.temperature,
        ...googleThinkingConfig(options.effort)
      }
    }
    yield* withProviderStream(
      'Google',
      {
        kind: 'google',
        baseUrl: this.baseUrl,
        model: options.model,
        endpoint: 'streamGenerateContent',
        request: requestBody
      },
      (stream) => this.chatInner(options.model, requestBody, stream)
    )
  }

  /**
   * `alt=sse` asks Gemini for a Server-Sent Events stream, so each event is a
   * complete `data:` JSON object.
   *
   * An earlier reader regex-scraped `"text": "..."` pairs straight out of the
   * raw body and then cleared the buffer on any match, which threw away
   * whatever partial event followed the last complete one -- output the user
   * never saw. It also matched any field named `text` anywhere in the payload.
   */
  private async *chatInner(
    model: string,
    requestBody: unknown,
    stream: ProviderStream
  ): AsyncGenerator<string, void, unknown> {
    const res = await openStream(
      stream,
      `${this.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        'Content-Type': 'application/json',
        // The key travels as a header rather than a query parameter: a URL is
        // the part of a request that ends up in logs and error text.
        'x-goog-api-key': this.apiKey
      },
      requestBody,
      'Google'
    )
    for await (const { data } of streamSse(res, stream.watchdog)) {
      const parsed = parseSseJson<{
        candidates?: { content?: { parts?: { text?: string }[] } }[]
      }>(data.trim())
      for (const candidate of parsed?.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.text) yield part.text
        }
      }
    }
  }

  async testConnection(
    model: string,
    effort?: AIEffortLevel
  ): Promise<{ model: string; responseMs: number }> {
    const start = Date.now()
    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      ...(effort ? { generationConfig: googleThinkingConfig(effort) } : {})
    }
    try {
      const res = await aiFetch(
        `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(REQUEST_START_TIMEOUT_MS)
        }
      )

      if (!res.ok) await throwProviderError(res, 'Google')
      logAiCall({
        kind: 'google-test-connection',
        baseUrl: this.baseUrl,
        model,
        endpoint: 'generateContent',
        request: requestBody,
        responseStatus: res.status,
        durationMs: Date.now() - start
      })
      return { model, responseMs: Date.now() - start }
    } catch (error) {
      logAiCall({
        kind: 'google-test-connection',
        baseUrl: this.baseUrl,
        model,
        endpoint: 'generateContent',
        request: requestBody,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start
      })
      throw error
    }
  }
}

function isOpenRouterBaseUrl(baseUrl: string): boolean {
  return normalizeProviderBaseUrl(baseUrl).toLowerCase() === 'https://openrouter.ai/api/v1'
}

/**
 * The effort field of a chat/completions request: OpenRouter's own
 * `reasoning.effort`, and OpenAI's `reasoning_effort` everywhere else.
 */
function chatCompletionsEffort(baseUrl: string, effort?: AIEffortLevel): Record<string, unknown> {
  if (!effort) return {}
  return isOpenRouterBaseUrl(baseUrl) ? { reasoning: { effort } } : { reasoning_effort: effort }
}

/** Gemini's `generationConfig.thinkingConfig.thinkingLevel`. */
function googleThinkingConfig(effort?: AIEffortLevel): Record<string, unknown> {
  return effort ? { thinkingConfig: { thinkingLevel: effort } } : {}
}

/**
 * Which effort levels a model takes, from the provider and nowhere else.
 *
 * Anthropic (`capabilities.effort`) and OpenRouter (`reasoning.supported_efforts`)
 * list them per model, so those listings are used as they are. Google's model
 * record says only whether a model thinks at all, and OpenAI's says nothing,
 * so for those (and any other server) each level is sent in a one-word
 * request: a level stays only when the provider accepts it. The same request
 * without an effort is sent first, so a level is never counted out for a
 * failure that has nothing to do with it; if that one fails, so does this.
 */
export async function getModelEffortSupport(
  provider: AIProvider,
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<AIModelEffortSupport> {
  const id = model.trim()
  if (!id) throw new Error(t('errors:aiAccess.chooseModelFirst'))
  const signal = AbortSignal.timeout(REQUEST_START_TIMEOUT_MS)

  if (provider === 'anthropic') {
    const base = normalizeProviderBaseUrl(baseUrl || 'https://api.anthropic.com/v1')
    const res = await aiFetch(`${base}/models/${encodeURIComponent(id)}`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal
    })
    if (!res.ok) await throwProviderError(res, 'Anthropic')
    const body = (await res.json()) as {
      capabilities?: {
        effort?: { supported?: boolean } & Partial<Record<string, { supported?: boolean } | null>>
      } | null
    }
    const effort = body.capabilities?.effort
    if (effort) {
      const levels = effort.supported
        ? AI_EFFORT_LEVELS.filter((level) => {
            const entry = effort[level]
            return typeof entry === 'object' && entry?.supported === true
          })
        : []
      return { model: id, levels, source: 'listing' }
    }
  } else if (provider === 'custom' && isOpenRouterBaseUrl(baseUrl)) {
    const res = await aiFetch(`${normalizeProviderBaseUrl(baseUrl)}/models`, {
      headers: bearerHeader(apiKey),
      signal
    })
    if (!res.ok) await throwProviderError(res, 'OpenRouter')
    const body = (await res.json()) as {
      data?: { id?: string; reasoning?: { supported_efforts?: string[] | null } }[]
    }
    const entry = body.data?.find((candidate) => candidate.id === id)
    if (entry) {
      // No `reasoning` object: the model has no effort setting. A null list:
      // every level OpenRouter itself takes is accepted.
      const listed = entry.reasoning?.supported_efforts
      const levels = !entry.reasoning
        ? []
        : listed == null
          ? [...AI_EFFORT_LEVELS]
          : AI_EFFORT_LEVELS.filter((level) => listed.includes(level))
      return { model: id, levels, source: 'listing' }
    }
  } else if (provider === 'google') {
    const base = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta')
    const res = await aiFetch(`${base}/models/${encodeURIComponent(id)}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal
    })
    if (!res.ok) await throwProviderError(res, 'Google')
    const body = (await res.json()) as { thinking?: boolean }
    if (body.thinking === false) return { model: id, levels: [], source: 'listing' }
  }

  const client = createProvider(provider, baseUrl, apiKey, id)
  await client.testConnection(id)
  const levels: AIEffortLevel[] = []
  for (const level of AI_EFFORT_LEVELS) {
    try {
      await client.testConnection(id, level)
      levels.push(level)
    } catch (error) {
      // A 4xx refusal (other than rate limits and auth, which the plain
      // request already passed) is the provider saying no to this level.
      const message = error instanceof Error ? error.message : String(error)
      if (!/API error: 4(?!01|03|29)\d\d/.test(message)) throw error
    }
  }
  return { model: id, levels, source: 'test' }
}

export function createProvider(
  provider: AIProvider,
  baseUrl: string,
  apiKey: string,
  model = '',
  sessionId?: string
): AIProviderInterface {
  switch (provider) {
    case 'openai': {
      const resolvedBaseUrl = baseUrl || 'https://api.openai.com/v1'
      if (usesOpenAIResponses(resolvedBaseUrl, model)) {
        return new OpenAIResponsesProvider(resolvedBaseUrl, apiKey, 'OpenAI Responses', sessionId)
      }
      return new OpenAICompatibleProvider(resolvedBaseUrl, apiKey, 'OpenAI', sessionId)
    }
    case 'anthropic':
      return new AnthropicProvider(
        baseUrl || 'https://api.anthropic.com/v1',
        apiKey,
        'Anthropic',
        sessionId
      )
    case 'google':
      return new GoogleProvider(
        baseUrl || 'https://generativelanguage.googleapis.com/v1beta',
        apiKey
      )
    case 'custom':
      if (usesOpenCodeResponses(baseUrl, model)) {
        return new OpenAIResponsesProvider(baseUrl, apiKey, 'OpenCode Responses', sessionId)
      }
      if (usesOpenAIResponses(baseUrl, model)) {
        return new OpenAIResponsesProvider(baseUrl, apiKey, 'OpenAI Responses', sessionId)
      }
      if (usesOpenCodeMessages(baseUrl, model)) {
        return new AnthropicProvider(baseUrl, apiKey, 'OpenCode Messages', sessionId)
      }
      return new OpenAICompatibleProvider(
        baseUrl,
        apiKey,
        isOpenCodeBaseUrl(baseUrl) ? 'OpenCode' : t('errors:aiProvider.customOpenaiCompatible'),
        sessionId
      )
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

// Non-chat models an OpenAI `/models` listing includes; none can answer a chat
// request, so offering them in a chat-model picker would only set up a failure.
const OPENAI_NON_CHAT_MODEL =
  /embedding|whisper|tts|dall-e|moderation|davinci|babbage|transcribe|realtime|image|audio/i

/**
 * Asks the provider which models this key can use. Used only to refresh the
 * Settings model picker; chat traffic never depends on it.
 */
export async function listProviderModels(
  provider: AIProvider,
  baseUrl: string,
  apiKey: string
): Promise<{ id: string; label: string }[]> {
  const signal = AbortSignal.timeout(REQUEST_START_TIMEOUT_MS)
  let models: { id: string; label: string }[]

  if (provider === 'google') {
    const base = normalizeBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta')
    const res = await aiFetch(`${base}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': apiKey },
      signal
    })
    if (!res.ok) await throwProviderError(res, 'Google')
    const body = (await res.json()) as {
      models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[]
    }
    models = (body.models ?? [])
      .filter((entry) => entry.supportedGenerationMethods?.includes('generateContent'))
      .flatMap((entry) => {
        const id = entry.name?.replace(/^models\//, '')
        return id ? [{ id, label: entry.displayName || id }] : []
      })
  } else if (provider === 'anthropic') {
    const base = normalizeProviderBaseUrl(baseUrl || 'https://api.anthropic.com/v1')
    const res = await aiFetch(`${base}/models?limit=1000`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal
    })
    if (!res.ok) await throwProviderError(res, 'Anthropic')
    const body = (await res.json()) as { data?: { id?: string; display_name?: string }[] }
    models = (body.data ?? []).flatMap((entry) =>
      entry.id ? [{ id: entry.id, label: entry.display_name || entry.id }] : []
    )
  } else {
    const resolved = provider === 'openai' ? baseUrl || 'https://api.openai.com/v1' : baseUrl
    if (!resolved.trim()) throw new Error(t('errors:aiProvider.enterBaseUrlBefore'))
    const base = normalizeProviderBaseUrl(resolved)
    const res = await aiFetch(`${base}/models`, {
      headers: bearerHeader(apiKey),
      signal
    })
    if (!res.ok)
      await throwProviderError(
        res,
        provider === 'openai' ? 'OpenAI' : t('errors:aiProvider.customProvider')
      )
    const body = (await res.json()) as { data?: { id?: string }[] }
    models = (body.data ?? []).flatMap((entry) =>
      entry.id && (provider !== 'openai' || !OPENAI_NON_CHAT_MODEL.test(entry.id))
        ? [{ id: entry.id, label: entry.id }]
        : []
    )
  }

  if (models.length === 0) throw new Error(t('errors:aiProvider.providerReturnedNoModels'))
  return models.sort((a, b) => a.id.localeCompare(b.id))
}
