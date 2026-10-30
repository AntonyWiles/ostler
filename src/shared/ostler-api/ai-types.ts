import { t } from '../i18n'
// ─── AI Types ───────────────────────────────────────────────────────────────

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'custom'

/** Settings › AI "Model can read images". */
export type AIVisionSetting = 'auto' | 'on' | 'off'

export const AI_VISION_SETTINGS: readonly AIVisionSetting[] = ['auto', 'on', 'off']

/** Shown when image parts were replaced by text descriptions, in the interface language. */
export function imagesAsDescriptionsWarning(): string {
  return t('ai:imagesAsDescriptions')
}

/**
 * The one rule for whether a request may carry image parts. "auto" sends
 * them and lets the provider decide: a model that refuses images gets the
 * request retried with descriptions (see chatWithImageFallback), so no model
 * name list is needed.
 */
export function visionEnabled(setting: AIVisionSetting | undefined): boolean {
  return setting !== 'off'
}

/** A library item attached to one chat message. Never carries image data. */
export interface AIMessageAttachment {
  libraryItemId: string
  revision: number
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  /** Library items attached to this (user) message, by id and revision only. */
  attachments?: AIMessageAttachment[]
}

export interface AIConversation {
  id: string
  timestamp: number
  projectId: string | null
  title: string
  messages: AIMessage[]
}

export interface AIStreamChunk {
  conversationId: string
  content: string
  done: boolean
  /** Set on the final chunk when images were sent as text descriptions. */
  warning?: string
}

export interface AIConnectionTest {
  model: string
  responseMs: number
}

/** Whether automatic AI activity is held off after an emergency stop. */
export interface AIHaltState {
  halted: boolean
  /** Embedded agent sessions the stop ended; only set by the stop itself. */
  stoppedSessions?: number
  /** Model requests waiting for a response; set by getAIHaltState. */
  activeRequests?: number
}

/** One model the configured provider reports as available to the current key. */
export interface AIModelInfo {
  id: string
  label: string
}

/**
 * Every effort (reasoning) level any provider takes, lowest first. Which of
 * them a model accepts is never assumed: `getModelEffortSupport` asks the
 * provider, and Settings offers only what it said.
 */
export const AI_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type AIEffortLevel = (typeof AI_EFFORT_LEVELS)[number]
/** Settings › AI "Effort": '' leaves it to the provider's own default. */
export type AIEffortSetting = AIEffortLevel | ''

export function isAIEffortLevel(value: unknown): value is AIEffortLevel {
  return typeof value === 'string' && (AI_EFFORT_LEVELS as readonly string[]).includes(value)
}

/** What a provider said about one model's effort levels. */
export interface AIModelEffortSupport {
  model: string
  /** The levels the model accepts, lowest first; empty when it takes none. */
  levels: AIEffortLevel[]
  /**
   * 'listing': the provider's models endpoint says so (Anthropic, OpenRouter).
   * 'test': the provider published nothing per level, so each level was sent
   * in a one-word request and kept only when the provider accepted it.
   */
  source: 'listing' | 'test'
}

/** A bounded transcript entry voluntarily supplied by an external harness agent. */
export interface SessionTranscriptEntry {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp: string
}

export interface SessionTranscript {
  projectId: string
  sessionId: string
  receivedAt: string
  entries: SessionTranscriptEntry[]
}

/**
 * A connection being set up in the guided setup, before it is saved: used to
 * list models and test it. The key travels to main only; nothing returns it.
 */
export interface AIConnectionDraft {
  /** An `AI_PRESETS` id; fills in the provider and address when they are left out. */
  presetId?: string
  provider?: AIProvider
  baseUrl?: string
  model?: string
  apiKey?: string
}

/**
 * What "Find it" found at a local provider's default address. Only the two
 * known addresses are ever asked, and only when the person presses the button.
 */
export type LocalAiDetection =
  | { status: 'found'; baseUrl: string; models: AIModelInfo[] }
  | { status: 'not-found'; baseUrl: string; message: string; downloadUrl: string }
  | { status: 'wrong-service'; baseUrl: string; message: string }

/** A project's Ostler AI settings, and what they come to. */
export interface ProjectAiSettings {
  projectId: string
  /** The project setting: Auto, Software or General. */
  profileSetting: 'auto' | 'software' | 'general'
  /** What Auto (or the override) comes to now: `projectAiProfile`. */
  profile: 'software' | 'general'
}
