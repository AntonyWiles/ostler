import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WebhookService,
  webhookBody,
  webhookUrlFits,
  type WebhookFetch
} from '../../electron/services/webhook-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const SLACK = 'https://hooks.slack.com/services/T000/B000/SecretPangolin42'
const seal = (url: string) => `sealed:${[...url].reverse().join('')}`
const open = (secret: string) => [...secret.slice('sealed:'.length)].reverse().join('')

describe('telling the team (integrations phase 4)', () => {
  const root = useTempDir('ostler-webhooks-')
  let service: WebhookService
  let fetch: ReturnType<typeof vi.fn<WebhookFetch>>
  let databasePath: string

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(root())
    fetch = vi.fn<WebhookFetch>(async () => ({ status: 200 }))
    service = new WebhookService(databasePath, {
      fetch,
      seal,
      open,
      projectName: (id) => (id === 'p1' ? 'Launch' : null),
      now: () => Date.parse('2026-10-23T09:00:00Z')
    })
  })

  afterEach(() => {
    service.close()
  })

  it('accepts only each service’s own https addresses', () => {
    expect(webhookUrlFits('slack', SLACK)).toBe(true)
    expect(webhookUrlFits('slack', 'http://hooks.slack.com/services/x')).toBe(false)
    expect(webhookUrlFits('slack', 'https://hooks.slack.com.evil.example/services/x')).toBe(false)
    expect(webhookUrlFits('discord', 'https://discord.com/api/webhooks/1/abc')).toBe(true)
    expect(webhookUrlFits('discord', 'https://discord.com/channels/1')).toBe(false)
    expect(
      webhookUrlFits(
        'teams',
        'https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual'
      )
    ).toBe(true)
    expect(webhookUrlFits('teams', 'https://example.webhook.office.com/webhookb2/x')).toBe(false)
    expect(webhookUrlFits('generic', 'https://hook.eu1.make.com/abc')).toBe(true)
    expect(webhookUrlFits('generic', 'http://localhost:5678/webhook')).toBe(false)
  })

  it('stores the address sealed and shows only its host', () => {
    const hook = service.add({
      projectId: 'p1',
      kind: 'slack',
      name: 'Team',
      url: SLACK,
      events: ['statusUpdate']
    })
    expect(hook).toMatchObject({ shown: 'hooks.slack.com/…', events: ['statusUpdate'] })
    expect(JSON.stringify(hook)).not.toContain('Pangolin')
    expect(() =>
      service.add({
        projectId: 'p1',
        kind: 'slack',
        name: 'x',
        url: 'https://example.com',
        events: ['statusUpdate']
      })
    ).toThrow(/hooks\.slack\.com|badUrl/)
    expect(() =>
      service.add({ projectId: 'p1', kind: 'slack', name: 'x', url: SLACK, events: [] })
    ).toThrow()
  })

  it('posts only the events each channel wants, in its own format, and records failures', async () => {
    const slack = service.add({
      projectId: 'p1',
      kind: 'slack',
      name: 'Team',
      url: SLACK,
      events: ['milestoneDone']
    })
    const discordUrl = 'https://discord.com/api/webhooks/1/token'
    service.add({
      projectId: 'p1',
      kind: 'discord',
      name: 'Discord',
      url: discordUrl,
      events: ['statusUpdate']
    })
    await service.send({
      kind: 'statusUpdate',
      projectId: 'p1',
      title: 'Status update: On track',
      text: 'Good week'
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(discordUrl)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      content: '**Launch: Status update: On track**\nGood week',
      allowed_mentions: { parse: [] }
    })
    expect(fetch.mock.calls[0][1].redirect).toBe('error')

    fetch.mockResolvedValueOnce({ status: 404 })
    await service.send({
      kind: 'milestoneDone',
      projectId: 'p1',
      title: 'Milestone done: Beta',
      text: ''
    })
    expect(service.list('p1').find((hook) => hook.id === slack.id)).toMatchObject({
      failure: 'refused'
    })
    fetch.mockRejectedValueOnce(new Error('offline'))
    const tested = await service.test(slack.id)
    expect(tested.failure).toBe('unreachable')
    const ok = await service.test(slack.id)
    expect(ok).toMatchObject({ failure: null, lastSentAt: Date.parse('2026-10-23T09:00:00Z') })
  })

  it('writes a Teams adaptive card and a generic JSON event', () => {
    const event = {
      kind: 'reviewWaiting' as const,
      projectId: 'p1',
      title: 'Review waiting: Fix login',
      text: ''
    }
    const teams = JSON.parse(webhookBody('teams', event, 'Launch', 0))
    expect(teams.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive')
    expect(teams.attachments[0].content.body).toEqual([
      { type: 'TextBlock', text: 'Launch: Review waiting: Fix login', weight: 'Bolder', wrap: true }
    ])
    expect(JSON.parse(webhookBody('generic', event, 'Launch', 0))).toEqual({
      event: 'reviewWaiting',
      project: { id: 'p1', name: 'Launch' },
      title: 'Review waiting: Fix login',
      text: '',
      at: '1970-01-01T00:00:00.000Z'
    })
  })
})
