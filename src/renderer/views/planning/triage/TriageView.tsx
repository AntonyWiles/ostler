import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type {
  LibraryItem,
  PlanningMilestone,
  PlanningPriority,
  PlanningWorkItem,
  PlanningWorkItemStatus,
  TriageAcceptFields,
  TriageList
} from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { formatRelativeTime } from '@shared/format'
import { TASK_PRIORITIES, taskPriorityLabel } from '@shared/task-labels'
import {
  Button,
  DateField,
  EmptyState,
  InlineAlert,
  Select,
  TextField,
  Toolbar,
  useToast
} from '../../../ui'
import { Inbox } from '../../../ui/icons'
import { usePeople } from '../../../context/PeopleContext'
import { useStatusWords } from '../../../context/ColumnsContext'
import { libraryFileUrl } from '../../project-detail/library/libraryUi'
import { TriageDialogs, type TriageDialog } from './TriageDialogs'
import { useFeatures } from '../../../navigation/features'
import type { TriageSuggestion } from '@shared/triage-suggestions'
import { markTriagedDuplicate } from './triage-actions'
import {
  SuggestButton,
  TriageSuggestionLine,
  useTriageSuggestions,
  type SuggestionState
} from './triage-suggestions'
import '../TaskToolbar.css'
import './TriageView.css'

/** What the To triage view needs from the workspace. */
export interface TriageWorkspace {
  projectId: string
  /** The project's planned tasks: what Duplicate of… offers. */
  workItems: PlanningWorkItem[]
  milestones: PlanningMilestone[]
  /** Opens a task in the drawer: a suggested duplicate's Open (N4.3b). */
  openWorkItem?: (item: PlanningWorkItem) => void
  /**
   * Reads the project's tasks again. A decision changes them in main, which
   * tells other windows but not this one, so the Board and the List would
   * miss an accepted task until something else reloaded them.
   */
  loadPlanning: () => Promise<unknown>
}

/** The decisions, each with its key (shown on its button). */
export const TRIAGE_KEYS = {
  accept: 'a',
  someday: 's',
  wontDo: 'w',
  duplicate: 'd',
  move: 'm'
} as const

type Decision = keyof typeof TRIAGE_KEYS

interface Draft {
  status: PlanningWorkItemStatus
  priority: PlanningPriority
  assigneeId: string
  labels: string
  targetDate: string
  milestoneId: string
}

function draftOf(item: PlanningWorkItem): Draft {
  return {
    status: 'backlog',
    priority: item.priority,
    assigneeId: item.assigneeId ?? '',
    labels: item.labels.join(', '),
    targetDate: item.targetDate ?? '',
    milestoneId: item.milestoneId ?? ''
  }
}

function fieldsOf(draft: Draft): TriageAcceptFields {
  return {
    status: draft.status,
    priority: draft.priority,
    assigneeId: draft.assigneeId || null,
    labels: draft.labels
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean),
    targetDate: draft.targetDate || null,
    milestoneId: draft.milestoneId || null
  }
}

/** What Accept's undo puts back. */
function acceptedFields(item: PlanningWorkItem): TriageAcceptFields {
  return {
    status: item.status,
    priority: item.priority,
    assigneeId: item.assigneeId,
    labels: item.labels,
    targetDate: item.targetDate,
    milestoneId: item.milestoneId
  }
}

/**
 * To triage (N4.3a, N33): a project's quick captures waiting for a decision,
 * oldest first. Each is accepted (with its fields set in the row first),
 * parked in Someday, closed as won't do, marked as a duplicate or moved to
 * another project, each with undo. The arrow keys move between rows and a
 * key per decision acts on the row in focus.
 */
export function TriageView({ ws }: { ws: TriageWorkspace }) {
  const { toast, toastUndo: showUndo } = useToast()
  const [list, setList] = useState<TriageList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [dialog, setDialog] = useState<TriageDialog | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const focusIndex = useRef(0)
  const projectId = ws.projectId
  const features = useFeatures()
  const suggestions = useTriageSuggestions(projectId)

  /** Reads the list again; the rows it read, or null when it couldn't. */
  const load = useCallback(async (): Promise<PlanningWorkItem[] | null> => {
    const result = await window.ostlerAPI.getTriage(projectId)
    if (!result.ok) {
      setError(result.error)
      return null
    }
    setError(null)
    setList(result.value)
    return result.value.items
  }, [projectId])

  // Every task change in the project reloads the workspace's tasks: reload too.
  useEffect(() => {
    void load()
  }, [load, ws.workItems])

  const loadPlanning = ws.loadPlanning
  /**
   * After a decision or its undo: To triage and the project's tasks, both
   * read again. An undo that brings a task back without changing the planned
   * tasks (Move to project's, Won't do's, Duplicate of's) would otherwise
   * leave it unseen here. The rows To triage read, or null.
   */
  const refresh = useCallback(async () => {
    const [rows] = await Promise.all([load(), loadPlanning()])
    return rows
  }, [load, loadPlanning])

  /** A decision's toast with Undo, which reads everything again once it has undone. */
  const toastUndo = useCallback(
    (title: string, undo: () => void | Promise<unknown>) =>
      showUndo(title, async () => {
        await undo()
        await refresh()
      }),
    [showUndo, refresh]
  )

  const items = list?.items ?? []
  const draft = (item: PlanningWorkItem) => drafts[item.id] ?? draftOf(item)
  const setDraft = (item: PlanningWorkItem, change: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [item.id]: { ...draft(item), ...change } }))

  /** Focuses the row at `index` (clamped) of `rows`, the rows shown now unless given. */
  const focusRow = (index: number, rows: PlanningWorkItem[] = items) => {
    const target = rows[Math.max(0, Math.min(index, rows.length - 1))]
    if (!target) return
    focusIndex.current = rows.indexOf(target)
    rowRefs.current.get(target.id)?.focus()
  }

  /**
   * After a decision, focus stays where the row was: on the next one. The
   * rows are the ones just read, not this render's, which still hold the
   * decided row (its element is gone, so focusing it would drop focus).
   */
  const decided = async (index: number) => {
    const rows = await refresh()
    if (rows) requestAnimationFrame(() => focusRow(index, rows))
  }

  const failed = (message: string) =>
    toast({ title: t('tasks:triage.couldntDecide'), body: message, tone: 'danger' })

  const accept = async (item: PlanningWorkItem, index: number) => {
    setBusyId(item.id)
    const before = acceptedFields(item)
    const result = await window.ostlerAPI.acceptTriagedWorkItem(
      projectId,
      item.id,
      fieldsOf(draft(item))
    )
    setBusyId(null)
    if (!result.ok) return failed(result.error)
    toastUndo(t('tasks:triage.accepted', { title: item.title }), () =>
      window.ostlerAPI.updatePlanningWorkItem(item.id, { ...before, inTriage: true })
    )
    await decided(index)
  }

  const someday = async (item: PlanningWorkItem, index: number) => {
    setBusyId(item.id)
    const result = await window.ostlerAPI.updatePlanningWorkItem(item.id, { someday: true })
    setBusyId(null)
    if (!result.ok) return failed(result.error)
    toastUndo(t('tasks:triage.parked', { title: item.title }), () =>
      window.ostlerAPI.updatePlanningWorkItem(item.id, { someday: false, inTriage: true })
    )
    await decided(index)
  }

  /** Use (N4.3b): the suggested priority and labels fill the row; Accept saves them. */
  const applySuggestion = (item: PlanningWorkItem, suggestion: TriageSuggestion) => {
    const current = draft(item)
    const labels = current.labels
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean)
    for (const label of suggestion.labels) if (!labels.includes(label)) labels.push(label)
    setDraft(item, {
      ...(suggestion.priority ? { priority: suggestion.priority } : {}),
      labels: labels.join(', ')
    })
    toast({ title: t('tasks:triageSuggest.used') })
  }

  const duplicateOf = async (item: PlanningWorkItem, originalId: string, index: number) => {
    if (busyId) return
    setBusyId(item.id)
    const failure = await markTriagedDuplicate(item, originalId, toastUndo)
    setBusyId(null)
    if (failure) return failed(failure)
    suggestions.dismiss(item.id)
    await decided(index)
  }

  const opener = (workItemId: string) => {
    const found = ws.workItems.find((candidate) => candidate.id === workItemId)
    const open = ws.openWorkItem
    return found && open ? () => open(found) : null
  }

  const decide = (decision: Decision, item: PlanningWorkItem, index: number) => {
    if (busyId) return
    if (decision === 'accept') void accept(item, index)
    else if (decision === 'someday') void someday(item, index)
    else setDialog({ kind: decision, item, index })
  }

  const onRowKey = (event: KeyboardEvent<HTMLLIElement>, item: PlanningWorkItem, index: number) => {
    // Keys act only on the row itself, never while typing in its fields.
    if (event.target !== event.currentTarget) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusRow(index + (event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    const decision = (Object.keys(TRIAGE_KEYS) as Decision[]).find(
      (key) => TRIAGE_KEYS[key] === event.key.toLowerCase()
    )
    if (!decision) return
    event.preventDefault()
    decide(decision, item, index)
  }

  return (
    <div className="triage-view">
      <Toolbar label={t('tasks:triage.viewTitle')} className="task-toolbar">
        <span className="task-toolbar__count" aria-live="polite">
          {t('tasks:triage.count', { count: items.length })}
        </span>
        {features.ai && items.length > 0 && (
          <span className="triage-view__suggest-all">
            {suggestions.run ? (
              <>
                <span aria-live="polite">{t('tasks:triageSuggest.progress', suggestions.run)}</span>
                <Button size="sm" variant="secondary" onClick={suggestions.stop}>
                  {t('tasks:triageSuggest.stop')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ai"
                title={t('tasks:triageSuggest.suggestHint')}
                onClick={() => void suggestions.suggestAll(items)}
              >
                {t('tasks:triageSuggest.suggestAll')}
              </Button>
            )}
          </span>
        )}
      </Toolbar>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {list && items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t('tasks:triage.emptyTitle')}
          description={t('tasks:triage.emptyBody')}
        />
      ) : (
        <>
          {items.length > 0 && <p className="triage-view__hint">{t('tasks:triage.keysHint')}</p>}
          <ul className="triage-view__list" aria-label={t('tasks:triage.viewTitle')}>
            {items.map((item, index) => (
              <TriageRow
                key={item.id}
                item={item}
                index={index}
                picture={list?.pictures[item.id] ?? null}
                draft={draft(item)}
                onDraft={(change) => setDraft(item, change)}
                milestones={ws.milestones}
                busy={busyId === item.id}
                rowRef={(element) => {
                  if (element) rowRefs.current.set(item.id, element)
                  else rowRefs.current.delete(item.id)
                }}
                onKeyDown={(event) => onRowKey(event, item, index)}
                onDecide={(decision) => decide(decision, item, index)}
                suggestion={
                  features.ai
                    ? {
                        state: suggestions.states[item.id],
                        onSuggest: () => void suggestions.suggest(item),
                        onUse: (suggestion) => applySuggestion(item, suggestion),
                        onDuplicate: (originalId) => void duplicateOf(item, originalId, index),
                        onOpen: opener,
                        onDismiss: () => suggestions.dismiss(item.id)
                      }
                    : null
                }
              />
            ))}
          </ul>
        </>
      )}
      <TriageDialogs
        dialog={dialog}
        projectId={projectId}
        workItems={ws.workItems}
        onClose={() => setDialog(null)}
        onDone={(index) => void decided(index)}
        onUndone={() => void refresh()}
      />
    </div>
  )
}

function TriageRow({
  item,
  index,
  picture,
  draft,
  onDraft,
  milestones,
  busy,
  rowRef,
  onKeyDown,
  onDecide,
  suggestion
}: {
  item: PlanningWorkItem
  index: number
  picture: LibraryItem | null
  draft: Draft
  onDraft: (change: Partial<Draft>) => void
  milestones: PlanningMilestone[]
  busy: boolean
  rowRef: (element: HTMLLIElement | null) => void
  onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => void
  onDecide: (decision: Decision) => void
  /** Suggest (N4.3b); null while Ostler AI is off. */
  suggestion: {
    state: SuggestionState | undefined
    onSuggest: () => void
    onUse: (suggestion: TriageSuggestion) => void
    onDuplicate: (originalId: string) => void
    onOpen: (workItemId: string) => (() => void) | null
    onDismiss: () => void
  } | null
}) {
  const people = usePeople()
  const words = useStatusWords(item.projectId)
  const captured = t('tasks:triage.captured', {
    when: formatRelativeTime(item.createdAt),
    how: t(`tasks:triage.capturedBy.${item.capturedBy ?? 'quick-add'}`)
  })
  const button = (decision: Decision, label: string, variant: 'primary' | 'secondary') => (
    <Button
      size="sm"
      variant={variant}
      disabled={busy}
      loading={busy && decision === 'accept'}
      aria-keyshortcuts={TRIAGE_KEYS[decision].toUpperCase()}
      onClick={() => onDecide(decision)}
    >
      {label}
      <kbd className="triage-row__key" aria-hidden="true">
        {TRIAGE_KEYS[decision].toUpperCase()}
      </kbd>
    </Button>
  )
  return (
    <li
      ref={rowRef}
      className="triage-row"
      tabIndex={index === 0 ? 0 : -1}
      aria-label={t('tasks:triage.rowName', { title: item.title, captured })}
      onKeyDown={onKeyDown}
    >
      <div className="triage-row__head">
        {picture && (
          <img
            className="triage-row__picture"
            src={libraryFileUrl(picture, 'thumb')}
            alt={t('tasks:triage.pictureAlt', { title: picture.title })}
          />
        )}
        <div className="triage-row__text">
          <span className="triage-row__title">{item.title}</span>
          <span className="triage-row__captured">{captured}</span>
        </div>
      </div>
      <div className="triage-row__fields">
        <Select
          size="sm"
          label={t('tasks:triage.status')}
          value={draft.status}
          onChange={(event) => onDraft({ status: event.target.value as PlanningWorkItemStatus })}
          options={words.visible(draft.status).map((status) => ({
            value: status,
            label: words.label(status)
          }))}
        />
        <Select
          size="sm"
          label={t('tasks:triage.priority')}
          value={draft.priority}
          onChange={(event) => onDraft({ priority: event.target.value as PlanningPriority })}
          options={TASK_PRIORITIES.map((priority) => ({
            value: priority,
            label: taskPriorityLabel(priority)
          }))}
        />
        <Select
          size="sm"
          label={t('tasks:triage.assignee')}
          value={draft.assigneeId}
          onChange={(event) => onDraft({ assigneeId: event.target.value })}
          options={[
            { value: '', label: t('tasks:triage.nobody') },
            ...people
              .offered(item.projectId)
              .map((person) => ({ value: person.id, label: person.name }))
          ]}
        />
        <TextField
          label={t('tasks:triage.labels')}
          hint={t('tasks:triage.labelsHint')}
          value={draft.labels}
          onChange={(event) => onDraft({ labels: event.target.value })}
        />
        <DateField
          label={t('tasks:triage.due')}
          value={draft.targetDate}
          onChange={(targetDate) => onDraft({ targetDate })}
        />
        <Select
          size="sm"
          label={t('tasks:triage.milestone')}
          value={draft.milestoneId}
          onChange={(event) => onDraft({ milestoneId: event.target.value })}
          options={[
            { value: '', label: t('tasks:triage.noMilestone') },
            ...milestones
              .filter((milestone) => milestone.status !== 'archived')
              .map((milestone) => ({ value: milestone.id, label: milestone.name }))
          ]}
        />
      </div>
      <div className="triage-row__actions">
        {button('accept', t('tasks:triage.accept'), 'primary')}
        {button('someday', t('tasks:triage.someday'), 'secondary')}
        {button('wontDo', t('tasks:triage.wontDo'), 'secondary')}
        {button('duplicate', t('tasks:triage.duplicate'), 'secondary')}
        {button('move', t('tasks:triage.move'), 'secondary')}
        {suggestion && (
          <SuggestButton item={item} state={suggestion.state} onSuggest={suggestion.onSuggest} />
        )}
      </div>
      {suggestion && (
        <TriageSuggestionLine
          item={item}
          state={suggestion.state}
          onUse={suggestion.onUse}
          onDuplicate={suggestion.onDuplicate}
          onOpen={suggestion.onOpen}
          onDismiss={suggestion.onDismiss}
        />
      )}
    </li>
  )
}
