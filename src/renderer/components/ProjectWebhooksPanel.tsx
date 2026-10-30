import { useCallback, useEffect, useState } from 'react'
import {
  MAX_WEBHOOK_NAME,
  TEAM_EVENT_KINDS,
  type ProjectWebhook,
  type RendererProject,
  type TeamEventKind,
  type WebhookKind
} from '@shared/ostler-api'
import { formatRelativeTime } from '@shared/format'
import { t } from '@shared/i18n'
import {
  Button,
  Checkbox,
  Dialog,
  InlineAlert,
  Select,
  TextField,
  useConfirm,
  useToast
} from '../ui'
import { CareGroup, CareRow } from './project-care/CareRow'

const KINDS: WebhookKind[] = ['teams', 'slack', 'discord', 'generic']

/**
 * Project settings › Sharing › Tell the team (integrations phase 4): the
 * channels this project posts its news to. Each says when it last posted and,
 * after a failure, why; Send a test checks it at once. The address goes in
 * once, to add, and is never shown again in full.
 */
export function ProjectWebhooksPanel({ project }: { project: RendererProject }) {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [webhooks, setWebhooks] = useState<ProjectWebhook[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.listWebhooks(project.id)
    if (result.ok) setWebhooks(result.value)
    else setError(result.error)
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  const test = async (webhook: ProjectWebhook) => {
    setBusy(webhook.id)
    setError(null)
    const result = await window.ostlerAPI.testWebhook(webhook.id)
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await load()
    if (!result.value.failure)
      toast({ title: t('settings:webhooks.tested', { name: webhook.name }) })
  }

  const remove = async (webhook: ProjectWebhook) => {
    const ok = await confirm({
      title: t('settings:webhooks.removeTitle', { name: webhook.name }),
      body: t('settings:webhooks.removeBody'),
      confirmLabel: t('settings:webhooks.remove'),
      tone: 'danger'
    })
    if (!ok) return
    const result = await window.ostlerAPI.removeWebhook(webhook.id)
    if (!result.ok) setError(result.error)
    await load()
  }

  return (
    <>
      <CareGroup
        title={t('settings:webhooks.title')}
        description={t('settings:webhooks.description')}
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            {t('settings:webhooks.add')}
          </Button>
        }
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {webhooks && webhooks.length === 0 && (
          <div className="project-care-row">
            <span className="project-care-row__description">{t('settings:webhooks.none')}</span>
          </div>
        )}
        {webhooks?.map((webhook) => (
          <CareRow
            key={webhook.id}
            title={`${webhook.name} · ${t(`settings:webhooks.kind.${webhook.kind}`)}`}
            description={[
              webhook.shown,
              webhook.events.map((event) => t(`settings:webhooks.eventLabel.${event}`)).join(', '),
              webhook.failure
                ? t('settings:webhooks.failedLine', {
                    when: formatRelativeTime(webhook.failedAt ?? Date.now()),
                    reason: t(`errors:webhooks.failure.${webhook.failure}`)
                  })
                : webhook.lastSentAt
                  ? t('settings:webhooks.lastSent', {
                      when: formatRelativeTime(webhook.lastSentAt)
                    })
                  : t('settings:webhooks.neverSent')
            ].join(' · ')}
            action={
              <>
                <Button
                  size="sm"
                  loading={busy === webhook.id}
                  disabled={busy !== null}
                  aria-label={t('settings:webhooks.testLabel', { name: webhook.name })}
                  onClick={() => void test(webhook)}
                >
                  {t('settings:webhooks.test')}
                </Button>
                <Button
                  size="sm"
                  aria-label={t('settings:webhooks.removeLabel', { name: webhook.name })}
                  onClick={() => void remove(webhook)}
                >
                  {t('settings:webhooks.remove')}
                </Button>
              </>
            }
          />
        ))}
      </CareGroup>
      {adding && (
        <AddWebhookDialog
          projectId={project.id}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false)
            await load()
          }}
        />
      )}
    </>
  )
}

function AddWebhookDialog({
  projectId,
  onClose,
  onAdded
}: {
  projectId: string
  onClose: () => void
  onAdded: () => Promise<void>
}) {
  const [kind, setKind] = useState<WebhookKind>('teams')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<TeamEventKind[]>([...TEAM_EVENT_KINDS])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    setError(null)
    const result = await window.ostlerAPI.addWebhook({
      projectId,
      kind,
      name: name.trim() || t(`settings:webhooks.kind.${kind}`),
      url: url.trim(),
      events
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onAdded()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!saving}
      title={t('settings:webhooks.addTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('settings:webhooks.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={saving || !url.trim() || events.length === 0}
            onClick={() => void save()}
          >
            {t('settings:webhooks.save')}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <Select
          label={t('settings:webhooks.kindLabel')}
          options={KINDS.map((value) => ({
            value,
            label: t(`settings:webhooks.kind.${value}`)
          }))}
          value={kind}
          onChange={(event) => setKind(event.target.value as WebhookKind)}
        />
        <p className="project-care-row__description">{t(`settings:webhooks.help.${kind}`)}</p>
        <TextField
          label={t('settings:webhooks.url')}
          type="url"
          value={url}
          hint={t('settings:webhooks.urlHint')}
          onChange={(event) => setUrl(event.target.value)}
        />
        <TextField
          label={t('settings:webhooks.name')}
          value={name}
          maxLength={MAX_WEBHOOK_NAME}
          placeholder={t(`settings:webhooks.kind.${kind}`)}
          onChange={(event) => setName(event.target.value)}
        />
        <fieldset className="dialog-form">
          <legend>{t('settings:webhooks.events')}</legend>
          {TEAM_EVENT_KINDS.map((event) => (
            <Checkbox
              key={event}
              label={t(`settings:webhooks.eventLabel.${event}`)}
              checked={events.includes(event)}
              onChange={(change) =>
                setEvents((current) =>
                  change.target.checked
                    ? TEAM_EVENT_KINDS.filter((item) => item === event || current.includes(item))
                    : current.filter((item) => item !== event)
                )
              }
            />
          ))}
        </fieldset>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  )
}
