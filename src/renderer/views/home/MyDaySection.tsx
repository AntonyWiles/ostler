import { useEffect, useState } from 'react'
import type { MyDayTask } from '@shared/ostler-api'
import { formatIsoDateShort } from '@shared/dates'
import { t } from '@shared/i18n'
import { useRepeatNotice } from '../../hooks/planning/useRepeatNotice'
import { useReorderableList } from '../../hooks/useMyDay'
import { Checkbox, IconButton, relativeDateText, useToast } from '../../ui'
import { GripVertical, X } from '../../ui/icons'
import { estimateText } from './my-day-text'
import { clockTime } from '@shared/planning/time-blocks'
import {
  blockPassedState,
  blockTimeRange,
  lengthText,
  useTimeBlocks
} from '../../hooks/useTimeBlocks'
import { FillDayButton, PassedBlocks } from '../../components/time-blocks/BlockMoves'
import { shiftIsoDate } from '@shared/dates'
import '../../components/time-blocks/time-blocks.css'
import { TaskLink } from '../planning/TaskPeek'
import { useAllSubprojects } from '../../hooks/useAllSubprojects'

/**
 * My day on Home (N1.4): the tasks picked for today, in the person's order.
 * A tick marks a task done through the normal update path (repeats,
 * reminders, activity and rules see it); done tasks stay, ticked, until the
 * day ends. Drag or Alt+Up/Down reorders, and Remove from My day has undo.
 */
export function MyDaySection({
  tasks,
  today,
  onChanged
}: {
  tasks: MyDayTask[]
  today: string
  onChanged: () => void
}) {
  const { toast, toastUndo } = useToast()
  const { labelFor } = useAllSubprojects([...new Set(tasks.map((task) => task.projectId))])
  const noticeRepeat = useRepeatNotice(async () => {})
  // The order shown at once on a move; the reload brings the saved one.
  const [order, setOrder] = useState(tasks)
  useEffect(() => setOrder(tasks), [tasks])

  // Blocking time never adds a task to My day; a task in it shows its block times.
  const { blocks, reload: reloadBlocks } = useTimeBlocks(today, today)
  // Blocks that move (N3.4b): blocks of the last week that passed with their tasks open.
  const recent = useTimeBlocks(shiftIsoDate(today, -7), today)
  const passed = recent.blocks.filter((block) => blockPassedState(block).passed)
  const blocksChanged = () => {
    reloadBlocks()
    recent.reload()
    onChanged()
  }
  const unfinished = order.some((task) => task.status !== 'done')
  const moves =
    passed.length > 0 || unfinished ? (
      <div className="block-moves-line">
        <PassedBlocks blocks={passed} onChanged={blocksChanged} />
        {unfinished && <FillDayButton date={today} onChanged={blocksChanged} />}
      </div>
    ) : null
  const timesOf = (taskId: string): string =>
    blocks
      .filter((block) => block.workItemId === taskId)
      .map((block) => blockTimeRange(block))
      .join(', ')

  const failed = (error: string) =>
    toast({ title: t('views:myDay.couldntChange'), body: error, tone: 'danger' })

  const { rowProps, onKeyDown } = useReorderableList(
    order,
    (task, placement, next) => {
      setOrder(next)
      void window.ostlerAPI.moveInMyDay(task.id, { date: today, ...placement }).then((result) => {
        if (!result.ok) failed(result.error)
        onChanged()
      })
    },
    (id) => `[data-my-day-id="${id}"]`
  )

  const setDone = async (task: MyDayTask, done: boolean) => {
    // The tick shows at once; the reload brings the saved status (or puts it back).
    setOrder((current) =>
      current.map((entry) =>
        entry.id === task.id ? { ...entry, status: done ? 'done' : 'ready' } : entry
      )
    )
    const result = await window.ostlerAPI.updatePlanningWorkItem(task.id, {
      status: done ? 'done' : 'ready'
    })
    if (!result.ok) {
      setOrder(tasks)
      return failed(result.error)
    }
    noticeRepeat(result.value)
    onChanged()
  }

  const remove = async (task: MyDayTask) => {
    const index = order.findIndex((candidate) => candidate.id === task.id)
    const previous = order[index - 1]
    const next = order[index + 1]
    const result = await window.ostlerAPI.removeFromMyDay(task.id, today)
    if (!result.ok) return failed(result.error)
    onChanged()
    toastUndo(t('views:myDay.removed', { title: task.title }), async () => {
      await window.ostlerAPI.addToMyDay(task.id, {
        date: today,
        ...(previous ? { afterId: previous.id } : next ? { beforeId: next.id } : {})
      })
      onChanged()
    })
  }

  // Today's time blocks (N3.4a), every project's, in time order, above the list.
  const blockList =
    blocks.length > 0 ? (
      <ul
        className="time-block-list ostler-my-day__blocks"
        aria-label={t('views:timeBlocks.today')}
      >
        {blocks.map((block) => {
          const state = blockPassedState(block)
          return (
            <li key={block.id}>
              <TaskLink
                className={state.passed ? 'time-block-chip is-passed' : 'time-block-chip'}
                projectId={block.projectId}
                taskId={block.workItemId}
                aria-label={`${state.label}, ${lengthText(block.lengthMinutes)}`}
              >
                <span className="time-block-times">{clockTime(block.startMinute)}</span>
                <span className="time-block-times">{lengthText(block.lengthMinutes)}</span>
                <span className="time-block-chip__title">{block.title}</span>
              </TaskLink>
            </li>
          )
        })}
      </ul>
    ) : null

  if (order.length === 0)
    return (
      <>
        {moves}
        {blockList}
        <p className="ostler-home-quiet">{t('views:myDay.empty')}</p>
      </>
    )

  return (
    <>
      {moves}
      {blockList}
      <ul className="ostler-home-tasks ostler-my-day" aria-label={t('views:myDay.tasks')}>
        {order.map((task) => {
          const row = rowProps(task)
          const done = task.status === 'done'
          const due = task.targetDate
            ? relativeDateText(task.targetDate) || formatIsoDateShort(task.targetDate)
            : null
          const estimate = estimateText(task)
          return (
            <li
              key={task.id}
              {...row}
              className={[
                'ostler-home-task',
                'ostler-my-day__task',
                done && 'is-done',
                row.className
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <GripVertical className="ostler-my-day__grip" aria-hidden="true" />
              <Checkbox
                label={null}
                aria-label={t(done ? 'views:myDay.markNotDone' : 'views:myDay.markDone', {
                  title: task.title
                })}
                checked={done}
                disabled={task.linked}
                onChange={(event) => void setDone(task, event.target.checked)}
              />
              <TaskLink
                className="ostler-home-task__title"
                projectId={task.projectId}
                taskId={task.id}
                data-my-day-id={task.id}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                title={t('views:myDay.move')}
                onKeyDown={(event) => onKeyDown(event, task)}
              >
                {task.title}
              </TaskLink>
              <span className="ostler-home-task__meta">
                <span className="ostler-home-task__project">
                  <span
                    className="ostler-home-task__dot"
                    style={{ background: task.projectColor }}
                    aria-hidden="true"
                  />
                  {labelFor(task.projectName, task.subprojectId)}
                </span>
                {due && (
                  <span className={task.targetDate! < today && !done ? 'is-overdue' : undefined}>
                    {due}
                  </span>
                )}
                {estimate && <span>{estimate}</span>}
                {timesOf(task.id) && (
                  <span className="time-block-times">
                    {t('views:timeBlocks.times', { times: timesOf(task.id) })}
                  </span>
                )}
                <IconButton
                  size="sm"
                  icon={X}
                  label={t('views:myDay.removeTask', { title: task.title })}
                  onClick={() => void remove(task)}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
