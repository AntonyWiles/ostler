import { useEffect, useState } from 'react'
import type { HarnessSession, HarnessSessionDiff } from '@shared/ostler-api'
import { useConfirm, useToast } from '../../../ui'
import { t } from '@shared/i18n'
import { openFindings } from '@shared/reviewer-runs'

type RunAction = (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>

/**
 * The review verdicts of a finished task (simplify pass §3), shared by the
 * Agents view's "Ready for you to review" and the task dialog so both say and
 * do the same thing: the task's changes, Apply (asking first when the folder
 * switched versions, §4), "Nothing changed: Close", and Discard.
 */
export function useTaskReview({
  projectId,
  session,
  runHarnessAction,
  onDone,
  draftCount = session.reviewDrafts?.length ?? 0,
  openMustFix = openFindings(session).filter((finding) => finding.severity === 'must-fix').length
}: {
  projectId: string
  session: HarnessSession
  runHarnessAction: RunAction
  /** After a verdict that ends the review, e.g. to close a dialog. */
  onDone?: () => void
  /** Draft line comments Apply would leave unsent (N9.2a); the session's own by default. */
  draftCount?: number
  /**
   * The reviewer's must-fix findings not dismissed (N9.5b), the session's own
   * by default: Apply asks first while there are any.
   */
  openMustFix?: number
}) {
  const confirm = useConfirm()
  const { toast } = useToast()
  const [diff, setDiff] = useState<HarnessSessionDiff | null>(null)
  const [diffError, setDiffError] = useState(false)

  useEffect(() => {
    if (!session.workspace) return
    let cancelled = false
    void window.ostlerAPI.getHarnessSessionDiff(projectId, session.id).then((result) => {
      if (cancelled) return
      if (result.ok) setDiff(result.value)
      else setDiffError(true)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, session.id, session.workspace])

  const nothingChanged = diff?.mergeReadiness === 'no_changes'

  const apply = async () => {
    if (openMustFix > 0) {
      const ok = await confirm({
        title: t('agents:reviewer.applyTitle'),
        body: t('agents:reviewer.applyBody', { count: openMustFix }),
        confirmLabel: t('agents:reviewer.applyAnyway'),
        cancelLabel: t('agents:lineComments.keepReviewing')
      })
      if (!ok) return
    }
    // Draft line comments go only with Send back: Apply asks before leaving them.
    if (draftCount > 0) {
      const ok = await confirm({
        title: t('agents:lineComments.applyTitle'),
        body: t('agents:lineComments.applyBody', { count: draftCount }),
        confirmLabel: t('agents:lineComments.applyAnyway'),
        cancelLabel: t('agents:lineComments.keepReviewing')
      })
      if (!ok) return
    }
    let onCurrentVersion = false
    if (diff?.versionChanged) {
      const ok = await confirm({
        title: t('agents:taskReview.versionChangedTitle'),
        body: t('agents:taskReview.versionChangedBody', {
          task: diff.taskVersion,
          folder: diff.folderVersion
        }),
        confirmLabel: t('agents:taskReview.applyToCurrentVersion'),
        cancelLabel: t('agents:taskReview.wait')
      })
      if (!ok) return
      onCurrentVersion = true
    }
    let outcome: 'applied' | 'nothing_changed' | 'sent_back' | null = null
    const done = await runHarnessAction(async () => {
      const result = await window.ostlerAPI.applyHarnessTaskWork(
        projectId,
        session.id,
        onCurrentVersion
      )
      if (result.ok) outcome = result.value.outcome
      return result
    })
    if (!done) return
    if (outcome === 'sent_back') {
      toast({
        title: t('agents:taskReview.sentBackTitle', { title: session.title }),
        body: t('agents:taskReview.sentBackBody'),
        tone: 'warning'
      })
    } else if (outcome === 'nothing_changed') {
      toast({ title: t('agents:taskReview.closed', { title: session.title }) })
    } else {
      toast({
        title: t('agents:taskReview.applied', { title: session.title }),
        body: t('agents:taskReview.appliedBody'),
        tone: 'success'
      })
    }
    onDone?.()
  }

  const discard = async () => {
    const ok = await confirm({
      title: t('agents:taskReview.discardTitle', { title: session.title }),
      body: t('agents:taskReview.discardBody'),
      confirmLabel: t('agents:taskReview.discard'),
      tone: 'danger'
    })
    if (!ok) return
    const done = await runHarnessAction(() =>
      window.ostlerAPI.discardHarnessTaskWork(projectId, session.id)
    )
    if (done) onDone?.()
  }

  return { diff, diffError, nothingChanged, apply, discard }
}
