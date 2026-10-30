import { describe, expect, it } from 'vitest'
import {
  MODEL_ANSWER_UNUSABLE,
  toFriendlyAiError,
  unusableAnswer,
  type AiErrorContext
} from '../../electron/services/ai-errors'
import { splitErrorDetails } from '../../src/shared/error-details'

const ollama = { provider: 'custom' as const, baseUrl: 'http://localhost:11434/v1' }
const openai = { provider: 'openai' as const, baseUrl: 'https://api.openai.com/v1' }

function advice(error: unknown, context: AiErrorContext = openai) {
  return splitErrorDetails(toFriendlyAiError(error, context).message)
}

describe('friendly AI errors', () => {
  it('says a refused key plainly, with the raw text behind Details', () => {
    for (const status of ['401 Unauthorized', '403 Forbidden']) {
      const raw = `OpenAI API error: ${status} — Incorrect API key provided`
      const { message, details } = advice(new Error(raw))
      expect(message).toMatch(/^The key was refused\./)
      expect(details).toBe(raw)
    }
  })

  it('asks whether a local provider is running when nothing answers', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
        code: 'ECONNREFUSED'
      })
    })
    expect(advice(error, ollama).message).toBe(
      'Nothing is answering at http://localhost:11434/v1. Is Ollama running?'
    )
  })

  it('says plainly when a model refuses a request setting', () => {
    const raw = 'Anthropic API error: 400 Bad Request — `temperature` is deprecated for this model.'
    const { message, details } = advice(new Error(raw), {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1'
    })
    expect(message).toBe(
      "This model doesn't accept a setting Ostler sent with the request. Choose another model in Settings › AI."
    )
    expect(details).toBe(raw)
  })

  it('says a missing model is not available', () => {
    const { message } = advice(
      new Error("Custom OpenAI-compatible API error: 404 Not Found — model 'llama9' not found"),
      ollama
    )
    expect(message).toMatch(/^That model isn't available\./)
  })

  it('says what to do about timeouts and rate limits', () => {
    expect(advice(new Error('OpenAI did not start responding within 60s.')).message).toMatch(
      /took too long.*Try again/
    )
    expect(advice(new Error('timed out'), ollama).message).toMatch(/smaller model/)
    expect(
      advice(new Error('OpenAI API error: 429 Too Many Requests — Rate limit reached')).message
    ).toMatch(/limiting requests.*Wait a minute/)
  })

  it('leaves errors it does not know, and its own messages, alone', () => {
    const unknown = new Error('Something odd')
    expect(toFriendlyAiError(unknown, openai)).toBe(unknown)
    const stopped = new Error('Stopped by the emergency stop.')
    expect(toFriendlyAiError(stopped, openai).message).toBe('Stopped by the emergency stop.')
    const mapped = toFriendlyAiError(new Error('OpenAI API error: 401 Unauthorized'), openai)
    expect(toFriendlyAiError(mapped, openai)).toBe(mapped)
  })

  it('turns a malformed draft into one plain message', () => {
    const { message, details } = splitErrorDetails(unusableAnswer('Not valid JSON.').message)
    expect(message).toBe(MODEL_ANSWER_UNUSABLE)
    expect(details).toBe('Not valid JSON.')
  })
})
