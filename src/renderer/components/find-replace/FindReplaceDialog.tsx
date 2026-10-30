import { useEffect, useMemo, useRef, useState } from 'react'
import {
  undoTextChanges,
  type FindReplaceMatch,
  type FindReplacePreview,
  type FindReplaceProblem,
  type FindReplaceRequest
} from '@shared/planning/find-replace'
import { t } from '@shared/i18n'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  InlineAlert,
  Skeleton,
  TextField,
  VisuallyHidden,
  useToast
} from '../../ui'
import './FindReplaceDialog.css'

export interface FindReplaceDialogProps {
  open: boolean
  projectId: string
  onClose: () => void
  /** After a replace and after its undo: the project's tasks read again. */
  onChanged: () => void
}

/** How long typing settles before the preview runs. */
const PREVIEW_DELAY_MS = 200

const PROBLEM_LABEL: Record<FindReplaceProblem, string> = {
  titleEmpty: 'views:findReplace.problemTitleEmpty',
  titleTooLong: 'views:findReplace.problemTitleTooLong',
  descriptionTooLong: 'views:findReplace.problemDescriptionTooLong',
  checklistEmpty: 'views:findReplace.problemChecklistEmpty',
  checklistTooLong: 'views:findReplace.problemChecklistTooLong',
  checklistDuplicate: 'views:findReplace.problemChecklistDuplicate'
}

function fieldLabel(match: FindReplaceMatch): string {
  if (match.field === 'title') return t('views:findReplace.fieldTitle')
  if (match.field === 'description') return t('views:findReplace.fieldDescription')
  return t('views:findReplace.fieldChecklist', { number: (match.itemIndex ?? 0) + 1 })
}

/**
 * Find and replace (N2.5): find a text across a project's task titles,
 * descriptions and checklists, see every match with the change inline, tick
 * the ones to change, and replace them in one step whose toast undoes it all.
 * Finding runs in the main process (`previewFindReplace`), so a large project
 * never holds up typing.
 */
export function FindReplaceDialog(props: FindReplaceDialogProps) {
  if (!props.open) return null
  return <FindReplaceDialogBody {...props} />
}

function FindReplaceDialogBody({ projectId, onClose, onChanged }: FindReplaceDialogProps) {
  const { toast, toastUndo } = useToast()
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWords, setWholeWords] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  /** The preview, and the request it answers. */
  const [preview, setPreview] = useState<{ key: string; value: FindReplacePreview } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Matches the person unticked. */
  const [left, setLeft] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const findRef = useRef<HTMLInputElement>(null)

  const request: FindReplaceRequest = { find, replace, matchCase, wholeWords, includeArchived }
  const key = JSON.stringify(request)

  useEffect(() => {
    if (!find) {
      setPreview(null)
      setError(null)
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      void window.ostlerAPI.previewFindReplace(projectId, request).then((result) => {
        if (!current) return
        if (result.ok) {
          setPreview({ key, value: result.value })
          setError(null)
        } else setError(result.error)
      })
    }, PREVIEW_DELAY_MS)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
    // key stands for every input of the request, so the preview runs once per change.
  }, [key, projectId])

  const fresh = preview?.key === key ? preview.value : null
  const matches = fresh?.matches ?? []
  const choosable = (match: FindReplaceMatch) => match.problem === null
  const chosen = matches.filter((match) => choosable(match) && !left.has(match.id))
  const groups = useMemo(() => {
    const byTask = new Map<string, FindReplaceMatch[]>()
    for (const match of matches)
      byTask.set(match.taskId, [...(byTask.get(match.taskId) ?? []), match])
    return [...byTask.values()]
  }, [matches])

  const setIncluded = (ids: readonly string[], include: boolean) =>
    setLeft((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (include) next.delete(id)
        else next.add(id)
      }
      return next
    })

  const apply = async () => {
    if (chosen.length === 0) return
    setBusy(true)
    const result = await window.ostlerAPI.applyFindReplace(projectId, replace, chosen)
    setBusy(false)
    if (!result.ok) {
      toast({ title: t('views:findReplace.couldntApply'), body: result.error, tone: 'danger' })
      return
    }
    onClose()
    onChanged()
    const { changed, skipped } = result.value
    toastUndo(
      t('views:findReplace.applied', { count: changed.length }),
      async () => {
        const undone = await window.ostlerAPI.revertFindReplace(projectId, undoTextChanges(changed))
        if (!undone.ok)
          toast({ title: t('views:findReplace.couldntUndo'), body: undone.error, tone: 'danger' })
        else if (undone.value.skipped.length > 0)
          toast({
            title: t('views:findReplace.undoSkipped', { count: undone.value.skipped.length }),
            tone: 'warning'
          })
        onChanged()
      },
      skipped.length > 0 ? t('views:findReplace.skipped', { count: skipped.length }) : undefined
    )
  }

  const choosableIds = matches.filter(choosable).map((match) => match.id)

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      canDismiss={!busy}
      title={t('views:findReplace.title')}
      description={t('views:findReplace.description')}
      initialFocusRef={findRef}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('views:findReplace.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void apply()}
            disabled={busy || fresh === null || chosen.length === 0}
          >
            {t('views:findReplace.apply', { count: chosen.length })}
          </Button>
        </>
      }
    >
      <div className="find-replace">
        <div className="find-replace__fields">
          <TextField
            ref={findRef}
            label={t('views:findReplace.find')}
            value={find}
            maxLength={500}
            onChange={(event) => {
              setFind(event.target.value)
              setLeft(new Set())
            }}
          />
          <TextField
            label={t('views:findReplace.replace')}
            value={replace}
            onChange={(event) => setReplace(event.target.value)}
          />
        </div>
        <div className="find-replace__options">
          <Checkbox
            label={t('views:findReplace.matchCase')}
            checked={matchCase}
            onChange={(event) => setMatchCase(event.target.checked)}
          />
          <Checkbox
            label={t('views:findReplace.wholeWords')}
            checked={wholeWords}
            onChange={(event) => setWholeWords(event.target.checked)}
          />
          <Checkbox
            label={t('views:findReplace.includeArchived')}
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
        </div>

        {error ? (
          <InlineAlert tone="danger">{t('views:findReplace.couldntFind', { error })}</InlineAlert>
        ) : !find ? (
          <p className="find-replace__quiet">{t('views:findReplace.typeToFind')}</p>
        ) : fresh === null ? (
          <div aria-busy="true" aria-label={t('views:findReplace.loading')}>
            <Skeleton lines={4} />
          </div>
        ) : matches.length === 0 ? (
          <p className="find-replace__quiet" role="status">
            {t('views:findReplace.nothing')}
          </p>
        ) : (
          <>
            <div className="find-replace__summary">
              <Checkbox
                label={t('views:findReplace.includeAll')}
                checked={choosableIds.length > 0 && chosen.length === choosableIds.length}
                indeterminate={chosen.length > 0 && chosen.length < choosableIds.length}
                disabled={choosableIds.length === 0}
                onChange={(event) => setIncluded(choosableIds, event.target.checked)}
              />
              <span role="status" className="find-replace__count">
                {t('views:findReplace.summary', {
                  matches: t('views:findReplace.matches', { count: matches.length }),
                  tasks: t('views:findReplace.tasks', { count: fresh.taskCount }),
                  chosen: chosen.length
                })}
              </span>
            </div>
            {fresh.truncated && (
              <InlineAlert tone="warning">
                {t('views:findReplace.truncated', { count: matches.length })}
              </InlineAlert>
            )}
            <ul className="find-replace__tasks" aria-label={t('views:findReplace.previewLabel')}>
              {groups.map((group) => {
                const first = group[0]!
                const ids = group.filter(choosable).map((match) => match.id)
                const taskChosen = ids.filter((id) => !left.has(id)).length
                return (
                  <li key={first.taskId} className="find-replace__task">
                    <div className="find-replace__task-head">
                      <Checkbox
                        label={first.taskTitle}
                        aria-label={t('views:findReplace.includeTask', { title: first.taskTitle })}
                        checked={ids.length > 0 && taskChosen === ids.length}
                        indeterminate={taskChosen > 0 && taskChosen < ids.length}
                        disabled={ids.length === 0}
                        onChange={(event) => setIncluded(ids, event.target.checked)}
                      />
                      {first.archived && <Badge>{t('views:findReplace.archived')}</Badge>}
                    </div>
                    <ul className="find-replace__matches">
                      {group.map((match) => (
                        <li
                          key={match.id}
                          className={
                            choosable(match) && !left.has(match.id)
                              ? 'find-replace__match'
                              : 'find-replace__match is-left'
                          }
                        >
                          <Checkbox
                            label={null}
                            aria-label={t('views:findReplace.includeMatch', {
                              field: fieldLabel(match),
                              title: match.taskTitle
                            })}
                            checked={choosable(match) && !left.has(match.id)}
                            disabled={!choosable(match)}
                            onChange={(event) => setIncluded([match.id], event.target.checked)}
                          />
                          <div className="find-replace__match-body">
                            <span className="find-replace__field">{fieldLabel(match)}</span>
                            <span className="find-replace__snippet">
                              {match.cutBefore && '…'}
                              {match.before}
                              <del>
                                <VisuallyHidden>{t('views:findReplace.oldText')} </VisuallyHidden>
                                {match.text}
                              </del>
                              <ins>
                                <VisuallyHidden>{t('views:findReplace.newText')} </VisuallyHidden>
                                {replace}
                              </ins>
                              {match.after}
                              {match.cutAfter && '…'}
                            </span>
                            {match.problem && (
                              <span className="find-replace__problem">
                                {t(PROBLEM_LABEL[match.problem])}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  )
}
