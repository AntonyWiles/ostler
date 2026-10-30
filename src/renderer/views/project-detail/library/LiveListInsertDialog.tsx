import { useEffect, useMemo, useState } from 'react'
import type {
  PlanningFieldDefinition,
  PlanningGoal,
  PlanningIteration,
  PlanningLabel,
  PlanningMilestone,
  PlanningTaskType,
  SavedView
} from '@shared/ostler-api'
import {
  fenceLiveListBlock,
  formatLiveListBlock,
  LIVE_LIST_DEFAULT_LIMIT,
  LIVE_LIST_MAX_LIMIT,
  type LiveListSpec
} from '@shared/live-list'
import {
  EMPTY_TASK_FILTER,
  effectiveFilter,
  type FilterNames,
  type TaskFilter
} from '@shared/task-filter'
import { SAVED_VIEW_TYPE_LABELS } from '@shared/saved-views'
import { t } from '@shared/i18n'
import {
  Button,
  Dialog,
  FilterBuilder,
  NumberField,
  SegmentedControl,
  Select,
  TextField,
  type FilterChoices
} from '../../../ui'
import { LiveList, liveListKey, useLiveLists } from '../../../ui/LiveList'
import { usePeople } from '../../../context/PeopleContext'
import { useProjectColumns } from '../../../context/ColumnsContext'
import { peopleOptions } from '../../planning/task-options'

interface ProjectRecords {
  views: SavedView[]
  milestones: PlanningMilestone[]
  goals: PlanningGoal[]
  labels: PlanningLabel[]
  iterations: PlanningIteration[]
  types: PlanningTaskType[]
  fields: PlanningFieldDefinition[]
}

const NO_RECORDS: ProjectRecords = {
  views: [],
  milestones: [],
  goals: [],
  labels: [],
  iterations: [],
  types: [],
  fields: []
}

async function valueOr<T>(
  call: Promise<{ ok: true; value: T } | { ok: false; error: string }>,
  fallback: T
) {
  const result = await call
  return result.ok ? result.value : fallback
}

/** What a filter's builder offers and how it words ids: this project's records, read once on open. */
function useProjectRecords(projectId: string, open: boolean): ProjectRecords | null {
  const [records, setRecords] = useState<ProjectRecords | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    const api = window.ostlerAPI
    void Promise.all([
      valueOr(api.listSavedViews(projectId), [] as SavedView[]),
      valueOr(api.getPlanningMilestones(projectId), [] as PlanningMilestone[]),
      valueOr(api.getPlanningGoals(projectId), [] as PlanningGoal[]),
      valueOr(api.getPlanningLabels(projectId), [] as PlanningLabel[]),
      valueOr(api.getPlanningIterations(projectId), [] as PlanningIteration[]),
      valueOr(api.getPlanningTaskTypes(projectId), [] as PlanningTaskType[]),
      valueOr(api.getPlanningFields(projectId), [] as PlanningFieldDefinition[])
    ]).then(([views, milestones, goals, labels, iterations, types, fields]) => {
      if (live)
        setRecords({
          views: views.filter((view) => !view.isDefault),
          milestones,
          goals,
          labels,
          iterations,
          types,
          fields
        })
    })
    return () => {
      live = false
    }
  }, [projectId, open])
  return records
}

export interface LiveListInsertDialogProps {
  open: boolean
  projectId: string
  onClose(): void
  /** The whole fenced block, to put into the note. */
  onInsert(block: string): void
}

/**
 * Insert a live list (N4.4c): a saved view or a filter, a title and a limit,
 * with a preview of what the note will show. A view gives its filter and
 * search only, and the dialog says so.
 */
export function LiveListInsertDialog({
  open,
  projectId,
  onClose,
  onInsert
}: LiveListInsertDialogProps) {
  const records = useProjectRecords(projectId, open) ?? NO_RECORDS
  const people = usePeople()
  const columns = useProjectColumns(projectId)
  const [source, setSource] = useState<'view' | 'filter'>('view')
  const [viewId, setViewId] = useState('')
  const [filter, setFilter] = useState<TaskFilter>(EMPTY_TASK_FILTER)
  const [title, setTitle] = useState('')
  const [limit, setLimit] = useState<number | null>(LIVE_LIST_DEFAULT_LIMIT)

  const hasViews = records.views.length > 0
  const kind = hasViews ? source : 'filter'
  const chosenView = records.views.find((view) => view.id === viewId) ?? records.views[0]

  const spec: LiveListSpec | null =
    kind === 'view'
      ? chosenView
        ? { source: { kind: 'view', viewId: chosenView.id }, title: null, limit: 1 }
        : null
      : { source: { kind: 'filter', filter: effectiveFilter(filter) }, title: null, limit: 1 }
  const cleanTitle = title.replace(/\s+/g, ' ').trim()
  const finalSpec: LiveListSpec | null = spec && {
    ...spec,
    title: cleanTitle || null,
    limit: Math.min(LIVE_LIST_MAX_LIMIT, Math.max(1, Math.round(limit ?? LIVE_LIST_DEFAULT_LIMIT)))
  }
  const body = finalSpec ? formatLiveListBlock(finalSpec, null) : ''
  const bodies = useMemo(() => (open && body ? [body] : []), [open, body])
  const preview = useLiveLists(projectId, bodies)
  const result = preview?.get(liveListKey(body))

  const choices: FilterChoices = {
    people: peopleOptions(people, []),
    milestones: records.milestones.map((milestone) => ({
      value: milestone.id,
      label: milestone.name
    })),
    goals: records.goals.map((goal) => ({ value: goal.id, label: goal.title })),
    labels: records.labels.map((label) => ({ value: label.name, label: label.name })),
    iterations: records.iterations.map((iteration) => ({
      value: iteration.id,
      label: iteration.name
    })),
    types: records.types.map((type) => ({ value: type.id, label: type.name }))
  }
  const names: FilterNames = {
    person: (id) => people.all.find((person) => person.id === id)?.name,
    milestone: (id) => records.milestones.find((milestone) => milestone.id === id)?.name,
    goal: (id) => records.goals.find((goal) => goal.id === id)?.title,
    iteration: (id) => records.iterations.find((iteration) => iteration.id === id)?.name,
    taskType: (id) => records.types.find((type) => type.id === id)?.name,
    customField: (id) => records.fields.find((field) => field.id === id),
    columns
  }

  const insert = () => {
    if (!finalSpec) return
    const words = result?.ok ? result.words : null
    onInsert(fenceLiveListBlock(formatLiveListBlock(finalSpec, words)))
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t('library:liveList.insert.title')}
      description={t('library:liveList.insert.description')}
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('library:liveList.insert.cancel')}
          </Button>
          <Button variant="primary" disabled={!finalSpec} onClick={insert}>
            {t('library:liveList.insert.insert')}
          </Button>
        </>
      }
    >
      <div className="ostler-live-list-insert">
        {hasViews ? (
          <SegmentedControl
            label={t('library:liveList.insert.source')}
            value={source}
            onChange={setSource}
            options={[
              { value: 'view', label: t('library:liveList.insert.fromView') },
              { value: 'filter', label: t('library:liveList.insert.fromFilter') }
            ]}
          />
        ) : (
          <p className="ostler-library-muted">{t('library:liveList.insert.noViews')}</p>
        )}
        {kind === 'view' && chosenView && (
          <>
            <Select
              label={t('library:liveList.insert.view')}
              value={chosenView.id}
              onChange={(event) => setViewId(event.target.value)}
              options={records.views.map((view) => ({
                value: view.id,
                label: `${view.name} (${SAVED_VIEW_TYPE_LABELS[view.viewType]})`
              }))}
            />
            <p className="ostler-library-muted">{t('library:liveList.insert.viewNote')}</p>
          </>
        )}
        {kind === 'filter' && (
          <FilterBuilder
            value={filter}
            onChange={setFilter}
            choices={choices}
            names={names}
            customFields={records.fields}
          />
        )}
        <TextField
          label={t('library:liveList.insert.listTitle')}
          hint={t('library:liveList.insert.titleHint')}
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
        <NumberField
          label={t('library:liveList.insert.limit')}
          unit={t('library:liveList.insert.limitUnit')}
          value={limit}
          min={1}
          max={LIVE_LIST_MAX_LIMIT}
          step={1}
          onChange={setLimit}
        />
        <div className="ostler-library-kicker">{t('library:liveList.insert.preview')}</div>
        {body && <LiveList body={body} projectId={projectId} result={result} />}
      </div>
    </Dialog>
  )
}
