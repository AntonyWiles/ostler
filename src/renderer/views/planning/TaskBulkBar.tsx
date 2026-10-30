import { useRef, useState, type ReactNode } from 'react'
import type { PlanningPriority, PlanningWorkItem } from '@shared/ostler-api'
import { type PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { Button, DateField, Popover, Select, TextField, Toolbar, useToast } from '../../ui'
import { Ban, Bot, CalendarDays, Lightbulb, Square, Tag, Trash2, Undo2, X } from '../../ui/icons'
import { isAiField } from '@shared/planning/ai-fields'
import { useAiFieldFill } from '../../hooks/planning/useAiFieldFill'
import { canCloseAsWontDo } from '@shared/planning/wont-do'
import { placeOfKey } from '@shared/board-columns'
import { useFeatures } from '../../navigation/features'
import { usePeople } from '../../context/PeopleContext'
import { peopleOptions, PRIORITY_OPTIONS } from './task-options'
import { liveSubprojects } from './subproject-ui'
import './TaskToolbar.css'
import { t } from '@shared/i18n'

/**
 * A task view's toolbar row, with the bulk bar laid over it while tasks are
 * selected. The filter row stays where it was, hidden and inert, so the row
 * keeps its height and nothing below it moves when a selection starts or is
 * cleared; the bulk bar keeps to that one row and scrolls sideways when it
 * has more than fits.
 */
export function TaskToolbarRow({ toolbar, bulkBar }: { toolbar: ReactNode; bulkBar: ReactNode }) {
  const selecting = bulkBar !== null && bulkBar !== undefined && bulkBar !== false
  return (
    <div className={`task-toolbar-row${selecting ? ' is-selecting' : ''}`}>
      <div className="task-toolbar-row__filters" inert={selecting || undefined}>
        {toolbar}
      </div>
      {selecting && <div className="task-toolbar-row__bulk">{bulkBar}</div>}
    </div>
  )
}

/**
 * Replaces the filter row while tasks are selected, on the Board and the List
 * alike: what can be done to all of them at once. Each action exists here
 * once, so both views do exactly the same thing. Moves follow the single-task rules: a task queued for an
 * agent moves through the queue, so a bulk move leaves it where it is.
 */
export function TaskBulkBar({
  ws,
  selectedIds,
  onClear
}: {
  ws: PlanningWorkspace
  selectedIds: string[]
  onClear: () => void
}) {
  const features = useFeatures()
  const people = usePeople()
  const { toast } = useToast()
  const dueButtonRef = useRef<HTMLButtonElement | null>(null)
  const [dueOpen, setDueOpen] = useState(false)
  const [due, setDue] = useState('')
  const labelsButtonRef = useRef<HTMLButtonElement | null>(null)
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [label, setLabel] = useState('')
  const selected = selectedIds
    .map((id) => ws.workItemsById.get(id))
    .filter((item): item is PlanningWorkItem => item !== undefined)
  // Everything Ready counts, not just what could start this second: queued
  // work whose dependencies are still open waits in the queue and releases
  // itself, which is the whole point of queuing a column at once.
  const queueable = selected.filter((item) => item.status === 'ready' && !item.linkedHarnessTaskId)

  // Won't do (N1.2) is offered for the unfinished ones; done tasks are left out.
  const closable = selected.filter((item) => canCloseAsWontDo(item, ws.projectedStatus(item)))

  const finish = () => onClear()

  // Fill with AI (N8.4): an AI field on every selected task, one at a time, with Stop.
  const aiFields = features.ai ? ws.fields.filter(isAiField) : []
  const aiFill = useAiFieldFill({
    projectId: ws.projectId,
    taskTypes: ws.taskTypes,
    reload: ws.loadPlanning
  })

  const moveTo = async (key: string) => {
    const place = placeOfKey(key, ws.statusWords.columns)
    if (!place) return
    const { status, columnId } = place
    // Queued work nobody has started moves too, out of the queue; a run's does not.
    const movable = selected.filter(
      (item) => !item.linkedHarnessTaskId || ws.harnessTaskFor(item)?.status === 'pending'
    )
    const kept = selected.length - movable.length
    await ws.bulkUpdateWorkItems(
      movable.map((item) => item.id),
      { status, columnId }
    )
    if (kept > 0)
      toast({
        title: t('tasks:taskBulkBar.queuedTasksWereNot', { count: kept }),
        body: t('tasks:taskBulkBar.taskQueuedAgentMoves')
      })
    finish()
  }

  const applyLabel = async (mode: 'add' | 'remove') => {
    const text = label.trim()
    if (!text) return
    await ws.bulkUpdateWorkItems(selectedIds, (item) => ({
      labels:
        mode === 'add'
          ? [...new Set([...item.labels, text])]
          : item.labels.filter((existing) => existing !== text)
    }))
    setLabel('')
    setLabelsOpen(false)
    finish()
  }

  return (
    <Toolbar label={t('tasks:taskBulkBar.bulkActions')} className="task-toolbar task-bulk-bar">
      <strong className="task-bulk-bar__count">
        {t('tasks:taskBulkBar.selected', { selectedIdCount: selectedIds.length })}
      </strong>
      <Select
        label={t('tasks:taskBulkBar.moveStatus')}
        hideLabel
        size="sm"
        value=""
        disabled={ws.busy}
        onChange={(event) => void moveTo(event.target.value)}
        options={[
          { value: '', label: t('tasks:taskBulkBar.move'), disabled: true },
          ...ws.statusWords.places().map((place) => ({ value: place.key, label: place.label }))
        ]}
      />
      <Select
        label={t('tasks:taskBulkBar.setPriority')}
        hideLabel
        size="sm"
        value=""
        disabled={ws.busy}
        onChange={(event) => {
          void ws
            .bulkUpdateWorkItems(selectedIds, { priority: event.target.value as PlanningPriority })
            .then(finish)
        }}
        options={[
          { value: '', label: t('tasks:taskBulkBar.priority'), disabled: true },
          ...PRIORITY_OPTIONS
        ]}
      />
      <Select
        label={t('tasks:taskBulkBar.setMilestone')}
        hideLabel
        size="sm"
        value=""
        disabled={ws.busy}
        onChange={(event) => {
          const value = event.target.value
          void ws
            .bulkUpdateWorkItems(selectedIds, { milestoneId: value === 'none' ? null : value })
            .then(finish)
        }}
        options={[
          { value: '', label: t('tasks:taskBulkBar.milestone'), disabled: true },
          { value: 'none', label: t('tasks:taskBulkBar.noMilestone') },
          ...ws.milestones.map((milestone) => ({ value: milestone.id, label: milestone.name }))
        ]}
      />
      {liveSubprojects(ws.subprojects).length > 0 && (
        <Select
          label={t('tasks:subprojects.moveTo')}
          hideLabel
          size="sm"
          value=""
          disabled={ws.busy}
          onChange={(event) => {
            const value = event.target.value
            void ws
              .bulkUpdateWorkItems(selectedIds, { subprojectId: value === 'none' ? null : value })
              .then(finish)
          }}
          options={[
            { value: '', label: t('tasks:subprojects.moveTo'), disabled: true },
            { value: 'none', label: t('tasks:subprojects.none') },
            ...liveSubprojects(ws.subprojects).map((sub) => ({ value: sub.id, label: sub.name }))
          ]}
        />
      )}
      {ws.taskTypes.length > 0 && (
        <Select
          label={t('tasks:taskTypes.setType')}
          hideLabel
          size="sm"
          value=""
          disabled={ws.busy}
          onChange={(event) => {
            const value = event.target.value
            void ws.bulkSetType(selectedIds, value === 'none' ? null : value).then(finish)
          }}
          options={[
            { value: '', label: t('tasks:taskTypes.field'), disabled: true },
            { value: 'none', label: t('tasks:taskTypes.noType') },
            ...ws.taskTypes.map((type) => ({ value: type.id, label: type.name }))
          ]}
        />
      )}
      <Select
        label={t('tasks:taskBulkBar.assign')}
        hideLabel
        size="sm"
        value=""
        disabled={ws.busy}
        onChange={(event) => {
          const value = event.target.value
          void ws
            .bulkUpdateWorkItems(selectedIds, { assigneeId: value === 'none' ? null : value })
            .then(finish)
        }}
        options={[
          { value: '', label: t('tasks:taskBulkBar.assign2'), disabled: true },
          { value: 'none', label: t('tasks:taskBulkBar.unassigned') },
          ...peopleOptions(people, [])
        ]}
      />
      <Button
        ref={dueButtonRef}
        size="sm"
        variant="ghost"
        icon={CalendarDays}
        aria-haspopup="dialog"
        aria-expanded={dueOpen}
        onClick={() => setDueOpen((open) => !open)}
      >
        {t('tasks:taskBulkBar.dueDate')}
      </Button>
      <Popover
        open={dueOpen}
        onClose={() => setDueOpen(false)}
        anchorRef={dueButtonRef}
        label={t('tasks:taskBulkBar.dueDateSelectedTasks')}
        className="task-bulk-bar__popover"
      >
        <DateField label={t('tasks:taskBulkBar.dueDate2')} value={due} onChange={setDue} />
        <div className="task-bulk-bar__popover-actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={ws.busy}
            onClick={() => {
              setDueOpen(false)
              void ws.bulkUpdateWorkItems(selectedIds, { targetDate: null }).then(finish)
            }}
          >
            {t('tasks:taskBulkBar.clearDueDate')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!due || ws.busy}
            onClick={() => {
              setDueOpen(false)
              void ws.bulkUpdateWorkItems(selectedIds, { targetDate: due }).then(finish)
            }}
          >
            {t('tasks:taskBulkBar.setDueDate')}
          </Button>
        </div>
      </Popover>
      <Button
        ref={labelsButtonRef}
        size="sm"
        variant="ghost"
        icon={Tag}
        aria-haspopup="dialog"
        aria-expanded={labelsOpen}
        onClick={() => setLabelsOpen((open) => !open)}
      >
        {t('tasks:taskBulkBar.labels')}
      </Button>
      <Popover
        open={labelsOpen}
        onClose={() => setLabelsOpen(false)}
        anchorRef={labelsButtonRef}
        label={t('tasks:taskBulkBar.labelsSelectedTasks')}
        className="task-bulk-bar__popover"
      >
        <TextField
          label={t('tasks:taskBulkBar.label')}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void applyLabel('add')
            }
          }}
        />
        <div className="task-bulk-bar__popover-actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={!label.trim() || ws.busy}
            onClick={() => void applyLabel('remove')}
          >
            {t('tasks:taskBulkBar.removeSelected')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!label.trim() || ws.busy}
            onClick={() => void applyLabel('add')}
          >
            {t('tasks:taskBulkBar.addSelected')}
          </Button>
        </div>
      </Popover>
      {aiFields.length > 0 &&
        (aiFill.progress ? (
          <span className="task-bulk-bar__ai-progress" role="status">
            {t('tasks:aiFields.fillingProgress', {
              name: aiFill.progress.fieldName,
              done: aiFill.progress.done,
              total: aiFill.progress.total
            })}
            <Button size="sm" variant="secondary" icon={Square} onClick={aiFill.stop}>
              {t('tasks:aiFields.stop')}
            </Button>
          </span>
        ) : (
          <Select
            label={t('tasks:aiFields.fillWithAi')}
            hideLabel
            size="sm"
            value=""
            disabled={ws.busy}
            onChange={(event) => {
              const field = aiFields.find((candidate) => candidate.id === event.target.value)
              if (field) void aiFill.fill(field, selected)
            }}
            options={[
              { value: '', label: t('tasks:aiFields.fillWithAi'), disabled: true },
              ...aiFields.map((field) => ({ value: field.id, label: field.name }))
            ]}
          />
        ))}
      {features.agents && queueable.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          icon={Bot}
          disabled={ws.busy}
          title={t('tasks:taskBulkBar.queueEverySelectedReady')}
          onClick={() => {
            void ws.queueWorkItems(selectedIds).then((queued) => {
              if (queued) finish()
            })
          }}
        >
          {t('tasks:taskBulkBar.queueAgent', { queueableCount: queueable.length })}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        icon={Ban}
        disabled={ws.busy || closable.length === 0}
        onClick={() => {
          ws.openWontDo(closable)
          finish()
        }}
      >
        {t('tasks:wontDo.menu')}
      </Button>
      {selected.some((item) => !item.someday) && (
        <Button
          size="sm"
          variant="ghost"
          icon={Lightbulb}
          disabled={ws.busy}
          onClick={() => {
            void ws.setSomeday(selected, true).then(finish)
          }}
        >
          {t('tasks:someday.moveTo')}
        </Button>
      )}
      {selected.some((item) => item.someday) && (
        <Button
          size="sm"
          variant="ghost"
          icon={Undo2}
          disabled={ws.busy}
          onClick={() => {
            void ws.setSomeday(selected, false).then(finish)
          }}
        >
          {t('tasks:someday.bringBack')}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        icon={Trash2}
        disabled={ws.busy}
        onClick={() => {
          void ws.deleteWorkItems(selected).then(finish)
        }}
      >
        {t('tasks:taskBulkBar.moveRecycleBin')}
      </Button>
      <Button size="sm" variant="ghost" icon={X} onClick={onClear}>
        {t('tasks:taskBulkBar.clearSelection')}
      </Button>
    </Toolbar>
  )
}
