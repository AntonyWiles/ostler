import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { stepPlacement } from '@shared/planning/board'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { Button, Select, StatusBadge, TextField, useAnnounce, useReorderMotion } from '../../ui'
import { Plus } from '../../ui/icons'
import { TaskDrawerSection } from './TaskDrawerSection'
import { AssigneeField } from './AssigneeField'
import { MoreDetails } from './MoreDetails'
import { TaskDueDateField, TaskEstimateField, TaskStartDateField } from './TaskScheduleFields'
import { WaitsOnField } from './WaitsOnField'
import { waitsOnChoices } from './TaskDependencies'
import { dependencyCandidates } from '@shared/planning/dependencies'
import { t } from '@shared/i18n'

/** 1 for a top-level item, 2 for its child, 3 for its grandchild. */
function depthOf(item: PlanningWorkItem, byId: Map<string, PlanningWorkItem>): number {
  let depth = 1
  let current: PlanningWorkItem = item
  const seen = new Set<string>([item.id])
  while (current.parentWorkItemId) {
    const parent = byId.get(current.parentWorkItemId)
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    depth++
    current = parent
  }
  return depth
}

/** Distinct (phaseNumber, phaseName) pairs already used by children of `parentId`, sorted by phase number. */
export function subtaskPhasesOf(
  workItems: PlanningWorkItem[],
  parentId: string
): { number: number; name: string }[] {
  const byNumber = new Map<number, string>()
  for (const child of workItems) {
    if (child.parentWorkItemId === parentId && child.subtaskPhaseNumber != null) {
      byNumber.set(child.subtaskPhaseNumber, child.subtaskPhaseName)
    }
  }
  return Array.from(byNumber.entries())
    .map(([number, name]) => ({ number, name }))
    .sort((a, b) => a.number - b.number)
}

/** "Phase 2", or "Phase 2: Build" when it has a name. */
export const phaseLabel = (phase: { number: number; name: string }) =>
  phase.name
    ? t('tasks:phase.named', { number: phase.number, name: phase.name })
    : t('tasks:phase.numbered', { number: phase.number })

/** A task's subtasks by phase, and adding one (up to three levels deep). */
/** The schedule and the waits-on a subtask is created with, from its More details. */
interface SubtaskDetails {
  assigneeId: string | null
  startDate: string
  targetDate: string
  estimate: number | null
  dependencyIds: string[]
}

const NO_DETAILS: SubtaskDetails = {
  assigneeId: null,
  startDate: '',
  targetDate: '',
  estimate: null,
  dependencyIds: []
}

export function TaskSubtasksSection({
  ws,
  item,
  openTask
}: {
  ws: PlanningWorkspace
  item: PlanningWorkItem
  /** Opens another task in the drawer, saving what is typed in this one first. */
  openTask: (task: PlanningWorkItem) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [phaseChoice, setPhaseChoice] = useState('')
  const [newPhaseName, setNewPhaseName] = useState('')
  const [details, setDetails] = useState<SubtaskDetails>(NO_DETAILS)
  const announce = useAnnounce()
  const [dragged, setDragged] = useState<string | null>(null)
  const phasesRef = useRef<HTMLDivElement | null>(null)
  useReorderMotion(phasesRef)
  const [dropAt, setDropAt] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  /** The subtask whose button gets focus back after Alt and an arrow moved it. */
  const [refocusId, setRefocusId] = useState<string | null>(null)
  useEffect(() => {
    if (!refocusId) return
    document.querySelector<HTMLElement>(`[data-subtask-id="${refocusId}"]`)?.focus()
    setRefocusId(null)
  })

  const depth = depthOf(item, ws.workItemsById)
  const children = ws.workItems.filter((candidate) => candidate.parentWorkItemId === item.id)
  const phases = subtaskPhasesOf(ws.workItems, item.id)
  const nextPhaseNumber =
    phases.length > 0 ? Math.max(...phases.map((phase) => phase.number)) + 1 : 1
  const canAddSubtask = depth < 3

  if (children.length === 0 && !canAddSubtask) return null

  const addSubtask = async () => {
    const choice = phaseChoice || (phases.length === 0 ? 'new' : '')
    if (!newTitle.trim() || !choice) return
    const phaseNumber = choice === 'new' ? nextPhaseNumber : Number(choice)
    const phaseName =
      choice === 'new'
        ? newPhaseName.trim()
        : (phases.find((phase) => phase.number === phaseNumber)?.name ?? '')
    const created = await ws.createSubtask(item, newTitle.trim(), phaseNumber, phaseName, {
      assigneeId: details.assigneeId,
      startDate: details.startDate || null,
      targetDate: details.targetDate || null,
      estimate: details.estimate,
      dependencyIds: details.dependencyIds
    })
    if (created) {
      setNewTitle('')
      setNewPhaseName('')
      setPhaseChoice('')
      setDetails(NO_DETAILS)
    }
  }
  const updateDetails = (patch: Partial<SubtaskDetails>) =>
    setDetails((current) => ({ ...current, ...patch }))
  const choice = phaseChoice || (phases.length === 0 ? 'new' : '')

  /** Alt and Up or Down on a subtask: one place up or down in its phase (D31). */
  const onSubtaskKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    child: PlanningWorkItem,
    siblings: PlanningWorkItem[]
  ) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const step = event.key === 'ArrowUp' ? -1 : 1
    const placement = stepPlacement(siblings, child, step)
    if (!placement) {
      announce(t('tasks:boardView.cannotMoveFurther'))
      return
    }
    const index = siblings.findIndex((candidate) => candidate.id === child.id)
    void ws.placeWorkItem(child, placement)
    setRefocusId(child.id)
    announce(
      t(step < 0 ? 'tasks:boardView.movedAbove' : 'tasks:boardView.movedBelow', {
        title: siblings[index + step].title,
        position: index + step + 1,
        count: siblings.length
      })
    )
  }

  /** Drag handlers for a subtask's row: it can be dropped above or below another in its phase. */
  const dragProps = (child: PlanningWorkItem, siblings: PlanningWorkItem[]) => ({
    draggable: !ws.busy,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      setDragged(child.id)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', child.id)
    },
    onDragEnd: () => {
      setDragged(null)
      setDropAt(null)
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragged || !siblings.some((sibling) => sibling.id === dragged)) return
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      const side = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
      if (dropAt?.id !== child.id || dropAt.side !== side) setDropAt({ id: child.id, side })
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      const moved = siblings.find((sibling) => sibling.id === dragged)
      const side = dropAt?.id === child.id ? dropAt.side : 'before'
      setDragged(null)
      setDropAt(null)
      if (!moved || moved.id === child.id) return
      void ws.placeWorkItem(
        moved,
        side === 'before' ? { beforeId: child.id } : { afterId: child.id }
      )
    }
  })

  return (
    <TaskDrawerSection
      title={
        children.length > 0
          ? t('tasks:taskSubtasksSection.subtasks', { childrenCount: children.length })
          : t('tasks:taskSubtasksSection.subtasks2')
      }
      part={{ id: 'subtasks', inUse: children.length > 0, start: () => setAdding(true) }}
      actions={
        canAddSubtask && !adding ? (
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding(true)}>
            {t('tasks:taskSubtasksSection.addSubtask')}
          </Button>
        ) : undefined
      }
    >
      <div ref={phasesRef} className="task-subtasks__phases">
        {phases.map((phase) => (
          <div key={phase.number} className="task-subtasks__phase">
            <h4 className="task-subtasks__phase-label">{phaseLabel(phase)}</h4>
            <ul className="task-subtasks__list">
              {(() => {
                const siblings = children.filter(
                  (child) => (child.subtaskPhaseNumber ?? 1) === phase.number
                )
                return siblings.map((child) => (
                  <li
                    key={child.id}
                    data-motion-key={child.id}
                    className={[
                      'task-subtasks__row',
                      dragged === child.id && 'is-dragging',
                      dropAt?.id === child.id && dragged !== child.id && `is-drop-${dropAt.side}`
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    {...dragProps(child, siblings)}
                  >
                    <StatusBadge
                      status={ws.projectedStatus(child)}
                      columnId={child.columnId}
                      iconOnly
                    />
                    <button
                      type="button"
                      className="task-subtasks__open"
                      data-subtask-id={child.id}
                      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                      onClick={() => openTask(child)}
                      onKeyDown={(event) => onSubtaskKeyDown(event, child, siblings)}
                    >
                      {child.title}
                    </button>
                  </li>
                ))
              })()}
            </ul>
          </div>
        ))}
      </div>
      {children.length === 0 && !adding && (
        <p className="task-drawer__muted">{t('tasks:taskSubtasksSection.noSubtasksSplitTask')}</p>
      )}
      {!canAddSubtask && (
        <p className="task-drawer__muted">{t('tasks:taskSubtasksSection.subtasksNestUpThree')}</p>
      )}
      {canAddSubtask && adding && (
        <div className="task-subtasks__add">
          <TextField
            label={t('tasks:taskSubtasksSection.newSubtaskTitle')}
            hideLabel
            placeholder={t('tasks:taskSubtasksSection.newSubtaskTitle')}
            autoFocus
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void addSubtask()
              }
            }}
          />
          <Select
            label={t('tasks:taskSubtasksSection.newSubtaskPhase')}
            hideLabel
            size="sm"
            value={choice}
            onChange={(event) => setPhaseChoice(event.target.value)}
            options={[
              ...(phases.length > 0
                ? [{ value: '', label: t('tasks:taskSubtasksSection.choosePhase'), disabled: true }]
                : []),
              ...phases.map((phase) => ({ value: String(phase.number), label: phaseLabel(phase) })),
              {
                value: 'new',
                label: t('tasks:taskSubtasksSection.newPhasePhase', { nextPhaseNumber })
              }
            ]}
          />
          {choice === 'new' && (
            <TextField
              label={t('tasks:taskSubtasksSection.newPhaseName')}
              hideLabel
              placeholder={t('tasks:taskSubtasksSection.phaseNameOptional')}
              value={newPhaseName}
              onChange={(event) => setNewPhaseName(event.target.value)}
            />
          )}
          <MoreDetails>
            <AssigneeField
              projectId={item.projectId}
              value={details.assigneeId}
              onChange={(assigneeId) => updateDetails({ assigneeId })}
            />
            <TaskStartDateField
              value={details.startDate}
              assigneeId={details.assigneeId}
              onChange={(startDate) => updateDetails({ startDate })}
            />
            <TaskDueDateField
              value={details.targetDate}
              assigneeId={details.assigneeId}
              startDate={details.startDate}
              onChange={(targetDate) => updateDetails({ targetDate })}
            />
            <TaskEstimateField
              projectId={item.projectId}
              value={details.estimate}
              onChange={(estimate) => updateDetails({ estimate })}
            />
            <WaitsOnField
              heading={t('tasks:taskDependencies.waits')}
              chosen={waitsOnChoices(ws, details.dependencyIds)}
              options={dependencyCandidates(
                {
                  id: '',
                  parentWorkItemId: item.id,
                  subtaskPhaseNumber: choice === 'new' ? nextPhaseNumber : Number(choice)
                },
                ws.workItems
              )
                .filter((candidate) => !details.dependencyIds.includes(candidate.id))
                .map((candidate) => ({ value: candidate.id, label: candidate.title }))}
              onAdd={(id) => updateDetails({ dependencyIds: [...details.dependencyIds, id] })}
              onRemove={(id) =>
                updateDetails({
                  dependencyIds: details.dependencyIds.filter((other) => other !== id)
                })
              }
              placeholder={t('tasks:taskDependencies.addTaskPhaseWaits')}
              emptyText={t('tasks:taskDependencies.noMatchingTasks')}
            />
          </MoreDetails>
          <div className="task-subtasks__add-actions">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t('tasks:taskSubtasksSection.cancel')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={ws.busy || !newTitle.trim() || !choice}
              onClick={() => void addSubtask()}
            >
              {t('tasks:taskSubtasksSection.addSubtask')}
            </Button>
          </div>
        </div>
      )}
    </TaskDrawerSection>
  )
}
