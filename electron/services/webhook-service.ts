/**
 * Telling the team (docs/plans/integrations/overview.md, phase 4). A project
 * posts a status update, a finished milestone or a review waiting to the
 * channels its webhooks name: Microsoft Teams through a Workflows webhook,
 * Slack, Discord, or any `https` endpoint (Zapier, Make, n8n, Power Automate).
 *
 * The address is the secret: it is sealed with Windows' protection, never
 * returned, and checked against the service's own hosts (Slack, Discord and
 * Teams) or `https` (any other). A post is one request with no redirects and
 * a 10-second limit; a failure is recorded on the webhook and never retried,
 * so a broken channel can't hold up the app. Nothing else is sent: only the
 * project's name and the event's own words.
 */
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  MAX_WEBHOOK_NAME,
  MAX_WEBHOOKS_PER_PROJECT,
  TEAM_EVENT_KINDS,
  type AddWebhookInput,
  type ProjectWebhook,
  type TeamEventKind,
  type UpdateWebhookInput,
  type WebhookFailure,
  type WebhookKind
} from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

const KINDS: readonly WebhookKind[] = ['teams', 'slack', 'discord', 'generic']
const TIMEOUT_MS = 10_000
const MAX_TEXT = 3000

/** One thing a project tells the team. */
export interface TeamEvent {
  kind: TeamEventKind
  projectId: string
  /** "Status update: On track", "Milestone done: Beta", "Review waiting: Fix login". */
  title: string
  /** The words below the title: the update's note, the milestone's outcome; may be empty. */
  text: string
}

export type WebhookFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
    signal: AbortSignal
    redirect: 'error'
  }
) => Promise<{ status: number }>

export interface WebhookServiceDependencies {
  fetch: WebhookFetch
  seal(url: string): string
  open(secret: string): string
  projectName(projectId: string): string | null
  now?: () => number
}

interface WebhookRow {
  id: string
  project_id: string
  kind: WebhookKind
  name: string
  url_secret: string
  url_shown: string
  events: string
  created_at: number
  last_sent_at: number | null
  failed_at: number | null
  failure: WebhookFailure | null
}

/** Whether `url` is a webhook address for `kind`: its service's own host, always https. */
export function webhookUrlFits(kind: WebhookKind, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false
  const host = parsed.hostname.toLowerCase()
  switch (kind) {
    case 'slack':
      return (
        host === 'hooks.slack.com' && /^\/(services|workflows|triggers)\//.test(parsed.pathname)
      )
    case 'discord':
      return (
        /^((ptb|canary)\.)?discord(app)?\.com$/.test(host) &&
        parsed.pathname.startsWith('/api/webhooks/')
      )
    case 'teams':
      // Workflows ("Post to a channel when a webhook request is received").
      return /\.logic\.azure\.com$/.test(host) || /\.powerplatform\.com$/.test(host)
    case 'generic':
      return parsed.hostname.length > 0
  }
}

/** The body each service expects. */
export function webhookBody(
  kind: WebhookKind,
  event: TeamEvent,
  projectName: string,
  at: number
): string {
  const heading = `${projectName}: ${event.title}`
  const text = event.text.length > MAX_TEXT ? `${event.text.slice(0, MAX_TEXT)}…` : event.text
  switch (kind) {
    case 'slack':
      return JSON.stringify({ text: text ? `*${heading}*\n${text}` : `*${heading}*` })
    case 'discord':
      return JSON.stringify({
        content: (text ? `**${heading}**\n${text}` : `**${heading}**`).slice(0, 2000),
        allowed_mentions: { parse: [] }
      })
    case 'teams':
      return JSON.stringify({
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
              type: 'AdaptiveCard',
              version: '1.4',
              body: [
                { type: 'TextBlock', text: heading, weight: 'Bolder', wrap: true },
                ...(text ? [{ type: 'TextBlock', text, wrap: true }] : [])
              ]
            }
          }
        ]
      })
    case 'generic':
      return JSON.stringify({
        event: event.kind,
        project: { id: event.projectId, name: projectName },
        title: event.title,
        text,
        at: new Date(at).toISOString()
      })
  }
}

export class WebhookService {
  private readonly db: Database.Database
  private readonly now: () => number
  /** Posts run one after another. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    dbPath: string,
    private readonly deps: WebhookServiceDependencies
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.now = deps.now ?? Date.now
  }

  close(): void {
    this.db.close()
  }

  list(projectId: string): ProjectWebhook[] {
    return (
      this.db
        .prepare('SELECT * FROM project_webhooks WHERE project_id = ? ORDER BY created_at, rowid')
        .all(projectId) as WebhookRow[]
    ).map(toWebhook)
  }

  add(input: AddWebhookInput): ProjectWebhook {
    const kind = this.kind(input?.kind)
    const projectId = typeof input?.projectId === 'string' ? input.projectId : ''
    if (!projectId || this.deps.projectName(projectId) === null) {
      throw new Refusal(t('errors:webhooks.noProject'))
    }
    if (this.list(projectId).length >= MAX_WEBHOOKS_PER_PROJECT) {
      throw new Refusal(t('errors:webhooks.tooMany', { count: MAX_WEBHOOKS_PER_PROJECT }))
    }
    const url = this.url(kind, input.url)
    const row: WebhookRow = {
      id: uuidv4(),
      project_id: projectId,
      kind,
      name: this.name(input.name),
      url_secret: this.seal(url),
      url_shown: shownUrl(url),
      events: JSON.stringify(this.events(input.events)),
      created_at: this.now(),
      last_sent_at: null,
      failed_at: null,
      failure: null
    }
    this.db
      .prepare(
        `INSERT INTO project_webhooks (id, project_id, kind, name, url_secret, url_shown, events, created_at)
         VALUES (@id, @project_id, @kind, @name, @url_secret, @url_shown, @events, @created_at)`
      )
      .run(row)
    return toWebhook(row)
  }

  update(id: string, input: UpdateWebhookInput): ProjectWebhook {
    const current = this.require(id)
    const next: WebhookRow = { ...current }
    if (input?.name !== undefined) next.name = this.name(input.name)
    if (input?.events !== undefined) next.events = JSON.stringify(this.events(input.events))
    if (input?.url !== undefined) {
      const url = this.url(current.kind, input.url)
      next.url_secret = this.seal(url)
      next.url_shown = shownUrl(url)
      next.failed_at = null
      next.failure = null
    }
    this.db
      .prepare(
        `UPDATE project_webhooks SET name = @name, events = @events, url_secret = @url_secret,
           url_shown = @url_shown, failed_at = @failed_at, failure = @failure WHERE id = @id`
      )
      .run(next)
    return toWebhook(next)
  }

  remove(id: string): void {
    this.require(id)
    this.db.prepare('DELETE FROM project_webhooks WHERE id = ?').run(id)
  }

  /** Posts a test message now; the webhook as it is afterwards (with any failure). */
  async test(id: string): Promise<ProjectWebhook> {
    const row = this.require(id)
    await this.enqueue(() =>
      this.post(row, {
        kind: 'statusUpdate',
        projectId: row.project_id,
        title: t('settings:webhooks.testTitle'),
        text: t('settings:webhooks.testText')
      })
    )
    return toWebhook(this.require(id))
  }

  /** Tells every webhook of the event's project that wants it. Never throws. */
  send(event: TeamEvent): Promise<void> {
    const rows = (
      this.db
        .prepare('SELECT * FROM project_webhooks WHERE project_id = ?')
        .all(event.projectId) as WebhookRow[]
    ).filter((row) => parseEvents(row.events).includes(event.kind))
    return this.enqueue(async () => {
      for (const row of rows) await this.post(row, event)
    }).catch((error) => console.error('Posting to a webhook failed:', error))
  }

  private async post(row: WebhookRow, event: TeamEvent): Promise<void> {
    const projectName = this.deps.projectName(row.project_id) ?? ''
    let failure: WebhookFailure | null = null
    let url: string
    try {
      url = this.deps.open(row.url_secret)
    } catch {
      return this.record(row.id, 'pasteAgain')
    }
    if (!webhookUrlFits(row.kind, url)) return this.record(row.id, 'refused')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await this.deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: webhookBody(row.kind, event, projectName, this.now()),
        signal: controller.signal,
        redirect: 'error'
      })
      if (response.status >= 200 && response.status < 300) failure = null
      else if ([401, 403, 404, 410].includes(response.status)) failure = 'refused'
      else failure = 'server'
    } catch {
      failure = controller.signal.aborted ? 'timeout' : 'unreachable'
    } finally {
      clearTimeout(timer)
    }
    this.record(row.id, failure)
  }

  private record(id: string, failure: WebhookFailure | null): void {
    const now = this.now()
    if (failure) {
      this.db
        .prepare('UPDATE project_webhooks SET failed_at = ?, failure = ? WHERE id = ?')
        .run(now, failure, id)
    } else {
      this.db
        .prepare(
          'UPDATE project_webhooks SET last_sent_at = ?, failed_at = NULL, failure = NULL WHERE id = ?'
        )
        .run(now, id)
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }

  private require(id: unknown): WebhookRow {
    const row =
      typeof id === 'string'
        ? (this.db.prepare('SELECT * FROM project_webhooks WHERE id = ?').get(id) as
            WebhookRow | undefined)
        : undefined
    if (!row) throw new Refusal(t('errors:webhooks.notFound'))
    return row
  }

  private kind(value: unknown): WebhookKind {
    if (!KINDS.includes(value as WebhookKind)) throw new Refusal(t('errors:webhooks.badKind'))
    return value as WebhookKind
  }

  private name(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name) throw new Refusal(t('errors:webhooks.needsName'))
    return name.slice(0, MAX_WEBHOOK_NAME)
  }

  private url(kind: WebhookKind, value: unknown): string {
    const url = typeof value === 'string' ? value.trim() : ''
    if (!webhookUrlFits(kind, url)) throw new Refusal(t(`errors:webhooks.badUrl.${kind}`))
    return url
  }

  private events(value: unknown): TeamEventKind[] {
    const events = Array.isArray(value)
      ? TEAM_EVENT_KINDS.filter((kind) => value.includes(kind))
      : []
    if (events.length === 0) throw new Refusal(t('errors:webhooks.needsEvent'))
    return events
  }

  private seal(url: string): string {
    try {
      return this.deps.seal(url)
    } catch {
      throw new Refusal(t('errors:webhooks.cannotEncrypt'))
    }
  }
}

function parseEvents(text: string): TeamEventKind[] {
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? TEAM_EVENT_KINDS.filter((kind) => value.includes(kind)) : []
  } catch {
    return []
  }
}

/** The host only: Slack's and Discord's tokens are in the path. */
function shownUrl(url: string): string {
  return `${new URL(url).hostname}/…`
}

function toWebhook(row: WebhookRow): ProjectWebhook {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    name: row.name,
    shown: row.url_shown,
    events: parseEvents(row.events),
    createdAt: row.created_at,
    lastSentAt: row.last_sent_at,
    failedAt: row.failed_at,
    failure: row.failure
  }
}
