import { useEffect, useState } from 'react'
import { Markdown } from '../../ui/Markdown'
import type { HarnessGuidance, HarnessSession } from '@shared/ostler-api'
import { formatRelativeTime } from '@shared/format'
import { Badge, Button, Dialog, InlineAlert, TextArea, useToast } from '../../ui'
import { MessageSquare } from '../../ui/icons'
import { t } from '@shared/i18n'
import './SendGuidance.css'

/** The longest message main accepts (MAX_GUIDANCE_LENGTH); the box stops there too. */
const MAX_GUIDANCE_LENGTH = 4000

/**
 * The guidance sent to one run, kept current from the harness state Ostler
 * pushes on every change, so a message's delivered state updates while the
 * dialog is open. Loads only while `active`.
 */
function useRunGuidance(projectId: string, sessionId: string, active: boolean): HarnessGuidance[] {
  const [guidance, setGuidance] = useState<HarnessGuidance[]>([])
  useEffect(() => {
    if (!active) return
    let current = true
    const pick = (all: HarnessGuidance[] | undefined) => {
      if (current) setGuidance((all ?? []).filter((entry) => entry.sessionId === sessionId))
    }
    void window.ostlerAPI.getHarnessState(projectId).then((result) => {
      if (result.ok) pick(result.value.guidance)
    })
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.projectId !== projectId || update.field !== 'harness') return
      const state = update.data as { guidance?: HarnessGuidance[] } | null
      if (state) pick(state.guidance)
    })
    return () => {
      current = false
      unsubscribe()
    }
  }, [projectId, sessionId, active])
  return guidance
}

/**
 * Send guidance… on a running run (D41): the person's message to the agent,
 * labelled as theirs. A built-in agent gets it in its session at once; a
 * connected agent on its next read of its session. The dialog lists what was
 * sent before and whether each message has reached the agent. Shown only for
 * a run that is still running: sending never starts, claims or ends anything.
 */
export function SendGuidanceButton({
  projectId,
  session,
  runTitle,
  size = 'sm',
  variant = 'secondary'
}: {
  projectId: string
  session: HarnessSession
  /** The task's title, for the button's accessible name. */
  runTitle?: string
  size?: 'sm' | 'md'
  variant?: 'secondary' | 'ghost'
}) {
  const [open, setOpen] = useState(false)
  if (session.status === 'done') return null
  const title = runTitle ?? session.title
  return (
    <>
      <Button
        size={size}
        variant={variant}
        icon={MessageSquare}
        aria-label={t('agents:guidance.sendTo', { title })}
        onClick={() => setOpen(true)}
      >
        {t('agents:guidance.send')}
      </Button>
      {open && (
        <GuidanceDialog
          projectId={projectId}
          session={session}
          title={title}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function GuidanceDialog({
  projectId,
  session,
  title,
  onClose
}: {
  projectId: string
  session: HarnessSession
  title: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const guidance = useRunGuidance(projectId, session.id, true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const embedded = session.provenance === 'embedded'

  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.sendHarnessGuidance(projectId, session.id, text)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setText('')
    toast({
      tone: 'success',
      title: result.value.deliveredAt
        ? t('agents:guidance.sentDelivered')
        : t('agents:guidance.sentWaiting')
    })
  }

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={!text.trim()}
      title={t('agents:guidance.title', { title })}
      description={
        embedded
          ? t('agents:guidance.descriptionBuiltIn')
          : t('agents:guidance.descriptionConnected')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('agents:guidance.close')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="send-guidance-form"
            loading={busy}
            disabled={!text.trim()}
            disabledReason={t('agents:guidance.writeFirst')}
          >
            {t('agents:guidance.sendButton')}
          </Button>
        </>
      }
    >
      <div className="send-guidance">
        {guidance.length > 0 && (
          <section aria-label={t('agents:guidance.earlier')}>
            <h3 className="send-guidance__heading">{t('agents:guidance.earlier')}</h3>
            <ul className="send-guidance__list">
              {guidance.map((entry) => (
                <li key={entry.id} className="send-guidance__item">
                  <div className="send-guidance__meta">
                    <span>
                      {t('agents:guidance.sentBy', {
                        name: entry.from,
                        when: formatRelativeTime(Date.parse(entry.sentAt))
                      })}
                    </span>
                    {entry.deliveredAt ? (
                      <Badge tone="success">{t('agents:guidance.delivered')}</Badge>
                    ) : (
                      <Badge tone="warning">{t('agents:guidance.waiting')}</Badge>
                    )}
                  </div>
                  <div className="send-guidance__text">
                    <Markdown>{entry.text}</Markdown>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <form
          id="send-guidance-form"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void send()
          }}
        >
          <TextArea
            label={t('agents:guidance.message')}
            hint={t('agents:guidance.hint', { max: MAX_GUIDANCE_LENGTH })}
            data-autofocus
            rows={4}
            maxLength={MAX_GUIDANCE_LENGTH}
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
        </form>
      </div>
    </Dialog>
  )
}
