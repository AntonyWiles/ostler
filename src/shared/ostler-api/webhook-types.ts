/**
 * Telling the team (docs/plans/integrations/overview.md, phase 4): a project
 * can post its news to a Microsoft Teams channel (through a Workflows
 * webhook), a Slack or Discord channel, or any `https` endpoint such as
 * Zapier, Make, n8n or Power Automate. The address is the secret, like a
 * calendar link: it is stored encrypted and never sent back in full.
 */

export type WebhookKind = 'teams' | 'slack' | 'discord' | 'generic'

/** What a project tells the team. */
export type TeamEventKind = 'statusUpdate' | 'milestoneDone' | 'reviewWaiting'

export const TEAM_EVENT_KINDS: readonly TeamEventKind[] = [
  'statusUpdate',
  'milestoneDone',
  'reviewWaiting'
]

export type WebhookFailure = 'unreachable' | 'timeout' | 'refused' | 'server' | 'pasteAgain'

export const MAX_WEBHOOKS_PER_PROJECT = 10
export const MAX_WEBHOOK_NAME = 80

export interface ProjectWebhook {
  id: string
  projectId: string
  kind: WebhookKind
  name: string
  /** The address shortened: its host and the end of it. */
  shown: string
  events: TeamEventKind[]
  createdAt: number
  lastSentAt: number | null
  failedAt: number | null
  failure: WebhookFailure | null
}

export interface AddWebhookInput {
  projectId: string
  kind: WebhookKind
  name: string
  /** The full address. A secret: never returned. */
  url: string
  events: TeamEventKind[]
}

export interface UpdateWebhookInput {
  name?: string
  events?: TeamEventKind[]
  /** A new address for the same channel. */
  url?: string
}
