import { useCallback, useEffect, useState } from 'react'
import type { HarnessPlan, HarnessPlanStatus, SessionPlanView } from '@shared/ostler-api'
import { MAX_PLAN_CHANGES_NOTE_LENGTH } from '@shared/plan-first'
import { Button, Dialog, InlineAlert, Skeleton, TextArea, useConfirm } from '../../ui'
import { formatRelativeTime } from '@shared/format'
import { t } from '@shared/i18n'
import './planning-dialogs.css'

/** A plan's status in words, the same everywhere a plan shows (N9.3b). */
export function planStatusLabel(status: HarnessPlanStatus): string {
  switch (status) {
    case 'pending':
      return t('agents:planFirst.statusPending')
    case 'approved':
      return t('agents:planFirst.statusApproved')
    case 'changes-requested':
      return t('agents:planFirst.statusChanges')
    case 'cancelled':
      return t('agents:planFirst.statusCancelled')
  }
}

/**
 * The steps, files and risks of a plan. The plan is the agent's own text, so
 * it is shown as plain text only: never Markdown or HTML, and no links.
 */
export function PlanContent({ plan }: { plan: Pick<HarnessPlan, 'steps' | 'files' | 'risks'> }) {
  return (
    <>
      <section className="dialog-section">
        <h3 className="dialog-section__title">{t('agents:planFirst.steps')}</h3>
        <ol className="dialog-list">
          {plan.steps.map((step, index) => (
            <li key={index} className="dialog-report">
              {step}
            </li>
          ))}
        </ol>
      </section>
      <section className="dialog-section">
        <h3 className="dialog-section__title">{t('agents:planFirst.files')}</h3>
        {plan.files.length > 0 ? (
          <ul className="dialog-list dialog-list--code">
            {plan.files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dialog-muted">{t('agents:planFirst.noFiles')}</p>
        )}
      </section>
      <section className="dialog-section">
        <h3 className="dialog-section__title">{t('agents:planFirst.risks')}</h3>
        {plan.risks ? (
          <p className="dialog-report">{plan.risks}</p>
        ) : (
          <p className="dialog-muted">{t('agents:planFirst.noRisks')}</p>
        )}
      </section>
    </>
  )
}

/**
 * The Plan dialog (N9.3b, N61): a run's plan waiting for approval, opened from
 * Home's Needs you, the Inbox or the Agents tab. Approve, Ask for changes
 * (with a note) and Cancel run (confirmed) go through the same harness
 * methods as the automation API.
 */
export function PlanDialog({
  projectId,
  sessionId,
  onClose,
  onDecided
}: {
  projectId: string
  sessionId: string
  onClose: () => void
  /** After a decision: the caller reloads what it shows. */
  onDecided?: () => void
}) {
  const confirm = useConfirm()
  const [view, setView] = useState<SessionPlanView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [changedSoFar, setChangedSoFar] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getHarnessSessionPlan(projectId, sessionId)
    if (result.ok) setView(result.value)
    else setLoadError(result.error)
  }, [projectId, sessionId])

  useEffect(() => {
    void load()
  }, [load])

  const plan = view?.plan ?? null
  const pending = plan?.status === 'pending'

  // Files the copy already changed while the plan waits: the agent was asked
  // not to, so the person sees it before approving.
  useEffect(() => {
    if (!pending) return
    let live = true
    void window.ostlerAPI.getHarnessSessionDiff(projectId, sessionId).then((result) => {
      if (live && result.ok) {
        const files = new Set([
          ...result.value.files.map((file) => file.path),
          ...(result.value.uncommittedFiles ?? [])
        ])
        setChangedSoFar(files.size)
      }
    })
    return () => {
      live = false
    }
  }, [pending, projectId, sessionId])

  /**
   * After Approve or Ask for changes: done, the dialog closes. When the plan
   * had already been decided elsewhere (the API, another window), it says so
   * and shows the plan as decided.
   */
  const decided = async (next: HarnessPlan, wanted: HarnessPlanStatus) => {
    onDecided?.()
    if (next.status === wanted && next.version === plan?.version && pending) return onClose()
    setNotice(t('agents:planFirst.alreadyDecided', { status: planStatusLabel(next.status) }))
    await load()
  }

  const approve = async () => {
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.approveHarnessPlan(projectId, sessionId)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    await decided(result.value, 'approved')
  }

  const sendNote = async () => {
    if (!note.trim()) return
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.requestHarnessPlanChanges(projectId, sessionId, note)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    await decided(result.value, 'changes-requested')
  }

  const cancelRun = async () => {
    const ok = await confirm({
      title: t('agents:planFirst.confirmCancelTitle'),
      body: t('agents:planFirst.confirmCancelBody'),
      confirmLabel: t('agents:planFirst.cancelRun'),
      cancelLabel: t('agents:planFirst.keepWaiting'),
      tone: 'danger'
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.stopHarnessSession(projectId, sessionId)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onDecided?.()
    onClose()
  }

  // The note the person wrote on the version before this one.
  const earlier =
    plan && plan.version > 1
      ? (view?.history.find((entry) => entry.version === plan.version - 1) ?? null)
      : null
  const changedBefore = plan?.changedBeforeApproval?.files ?? []

  const footer = pending ? (
    <>
      <Button variant="danger" disabled={busy} onClick={() => void cancelRun()}>
        {t('agents:planFirst.cancelRun')}
      </Button>
      <Button
        variant="secondary"
        disabled={busy}
        aria-expanded={asking}
        onClick={() => setAsking((open) => !open)}
      >
        {t('agents:planFirst.askForChanges')}
      </Button>
      <Button variant="primary" loading={busy} onClick={() => void approve()}>
        {t('agents:planFirst.approve')}
      </Button>
    </>
  ) : (
    <Button variant="primary" onClick={onClose}>
      {t('agents:planFirst.close')}
    </Button>
  )

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={t('agents:planFirst.dialogTitle')}
      description={view?.title || undefined}
      footer={footer}
    >
      <div className="dialog-form">
        {loadError && <InlineAlert tone="danger">{loadError}</InlineAlert>}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {notice && <InlineAlert tone="info">{notice}</InlineAlert>}
        {!view && !loadError && <Skeleton lines={4} />}
        {view && !plan && <p className="dialog-muted">{t('agents:planFirst.noPlan')}</p>}
        {plan && (
          <>
            <p className="dialog-muted">
              {earlier
                ? t('agents:planFirst.versionAfterNote', { version: plan.version })
                : t('agents:planFirst.version', { version: plan.version })}
              {' · '}
              {planStatusLabel(plan.status)}
              {' · '}
              {formatRelativeTime(new Date(plan.submittedAt).getTime())}
            </p>
            {pending && <p className="dialog-muted">{t('agents:planFirst.runWaits')}</p>}
            {earlier?.changesNote && (
              <section className="dialog-section">
                <h3 className="dialog-section__title">
                  {t('agents:planFirst.earlierNote', { version: earlier.version })}
                </h3>
                <p className="dialog-report">{earlier.changesNote}</p>
              </section>
            )}
            {pending && changedSoFar > 0 && (
              <InlineAlert tone="warning">
                {t('agents:planFirst.changedWhileWaiting', { count: changedSoFar })}
              </InlineAlert>
            )}
            {changedBefore.length > 0 && (
              <InlineAlert tone="warning">
                {t('agents:planFirst.changedBeforeApproval', { count: changedBefore.length })}
                <ul className="dialog-list dialog-list--code">
                  {changedBefore.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ul>
              </InlineAlert>
            )}
            <p className="dialog-muted">{t('agents:planFirst.agentsOwnText')}</p>
            <PlanContent plan={plan} />
            {plan.status === 'changes-requested' && plan.changesNote && (
              <section className="dialog-section">
                <h3 className="dialog-section__title">{t('agents:planFirst.yourNote')}</h3>
                <p className="dialog-report">{plan.changesNote}</p>
              </section>
            )}
            {pending && asking && (
              <form
                className="dialog-section"
                onSubmit={(event) => {
                  event.preventDefault()
                  void sendNote()
                }}
              >
                <TextArea
                  label={t('agents:planFirst.changesNote')}
                  hint={t('agents:planFirst.changesNoteHint')}
                  value={note}
                  maxLength={MAX_PLAN_CHANGES_NOTE_LENGTH}
                  required
                  rows={3}
                  onChange={(event) => setNote(event.target.value)}
                />
                <div className="dialog-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    disabled={!note.trim()}
                    disabledReason={t('agents:planFirst.noteRequired')}
                  >
                    {t('agents:planFirst.sendNote')}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
