import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnthropicProvider,
  GoogleProvider,
  OpenAICompatibleProvider,
  OpenAIResponsesProvider,
  type AIProviderInterface
} from '../../electron/services/ai-provider'

/** A response whose body arrives in exactly these pieces, split wherever a test likes. */
function chunked(pieces: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece))
      controller.close()
    }
  })
  return new Response(body, { status: 200 })
}

async function collect(provider: AIProviderInterface, pieces: string[]): Promise<string[]> {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(chunked(pieces))
  const chunks: string[] = []
  for await (const chunk of provider.chat([{ role: 'user', content: 'hello' }], {
    model: 'm',
    maxTokens: 10,
    temperature: 0,
    stream: true
  })) {
    chunks.push(chunk)
  }
  return chunks
}

describe('streamed provider output split mid-line', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('OpenAI-compatible: joins split lines, keeps an unterminated last event, stops at [DONE]', async () => {
    const chunks = await collect(new OpenAICompatibleProvider('https://api.example.com/v1', 'k'), [
      'data: {"choices":[{"delta":{"content":"Hel',
      'lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}',
      '\n\ndata: {"choices":[{"delta":{"content":"!"}}]}'
    ])
    expect(chunks).toEqual(['Hello', ' there', '!'])

    const done = await collect(new OpenAICompatibleProvider('https://api.example.com/v1', 'k'), [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\nda',
      'ta: [DONE]\n\ndata: {"choices":[{"delta":{"content":"after"}}]}\n\n'
    ])
    expect(done).toEqual(['a'])
  })

  it('OpenAI Responses: joins split lines and keeps an unterminated last delta', async () => {
    const chunks = await collect(new OpenAIResponsesProvider('https://api.example.com/v1', 'k'), [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.de',
      'lta","delta":"Hi"}\n\ndata: {"type":"response.output_text.delta","delta":" you"}'
    ])
    expect(chunks).toEqual(['Hi', ' you'])
  })

  it('Anthropic: keeps the event name when the chunk boundary falls between event and data', async () => {
    const chunks = await collect(new AnthropicProvider('https://api.example.com/v1', 'k'), [
      'event: message_start\ndata: {"type":"message_start"}\n\nevent: content_block_delta\n',
      'data: {"delta":{"type":"text_delta","text":"One"}}\n\nevent: content_block_del',
      'ta\ndata: {"delta":{"type":"text_delta","text":" two"}}'
    ])
    expect(chunks).toEqual(['One', ' two'])
  })

  it('Google: joins split lines and keeps an unterminated last event', async () => {
    const chunks = await collect(new GoogleProvider('https://api.example.com/v1beta', 'k'), [
      'data: {"candidates":[{"content":{"parts":[{"text":"Good"}]}}]}\r\n\r\ndata: {"candi',
      'dates":[{"content":{"parts":[{"text":" day"}]}}]}'
    ])
    expect(chunks).toEqual(['Good', ' day'])
  })
})
