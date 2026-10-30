import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssignedTask, RendererProject } from '@shared/ostler-api'
import { shiftIsoDate } from '@shared/dates'
import { hasPeopleToPlanFor, isCountedTask, planWorkloadWeeks } from '@shared/planning/plan-steps'
import { computeWorkload, weeksOverCapacity } from '@shared/planning/workload'
import { usePeople } from '../../../context/PeopleContext'
import { useDaysOff } from '../../../context/DaysOffContext'
import { useToday } from '../../../hooks/useToday'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'

export interface PlanPeople {
  /** The D11 rule: whether the People step shows. */
  show: boolean
  loading: boolean
  error: string | null
  /** From `weeksOverCapacity`, only people with counted tasks in this project. */
  overWeeks: { personId: string; week: string; over: number }[]
  /** People with counted tasks here and no weekly hours set. */
  noCapacityCount: number
}

interface Reply {
  tasks: AssignedTask[] | null
  error: string | null
}

/**
 * The People step's facts: whether it shows, and who with work in this project
 * is over capacity in the plan's weeks. A person's load counts their work in
 * every project, so the Workload view's query asks for all of them; the one
 * rule (`computeWorkload`, `weeksOverCapacity`) does the counting.
 */
export function usePlanPeople(project: RendererProject, ws: PlanningWorkspace): PlanPeople {
  const people = usePeople()
  const { daysOff } = useDaysOff()
  const today = useToday()

  // Wait for people: before they load, a task given to Me would look like someone else's.
  const show =
    people.loaded &&
    hasPeopleToPlanFor({ projectId: project.id, workItems: ws.workItems, people: people.all })

  const counted = useMemo(() => ws.workItems.filter(isCountedTask), [ws.workItems])
  const weeks = useMemo(() => planWorkloadWeeks(today, counted), [today, counted])
  const through = shiftIsoDate(weeks[weeks.length - 1], 6)
  // Reload when what moves the load changes: who, when and how long.
  const askedKey = JSON.stringify([
    through,
    counted.map((item) => [item.assigneeId, item.startDate, item.targetDate, item.estimate])
  ])

  const [reply, setReply] = useState<Reply | null>(null)
  const request = useRef(0)
  useEffect(() => {
    if (!show) return
    const load = () => {
      const mine = ++request.current
      window.ostlerAPI.getWorkloadTasks({ through }).then(
        (result) => {
          if (mine !== request.current) return
          setReply(
            result.ok ? { tasks: result.value, error: null } : { tasks: null, error: result.error }
          )
        },
        (error: unknown) => {
          if (mine === request.current) setReply({ tasks: null, error: String(error) })
        }
      )
    }
    load()
    const stop = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') load()
    })
    return () => {
      request.current++
      stop()
    }
    // `askedKey` holds `through` and this project's counted tasks.
  }, [show, askedKey, through])

  return useMemo(() => {
    const assigned = new Set(counted.flatMap((item) => (item.assigneeId ? [item.assigneeId] : [])))
    const working = people.all.filter((person) => assigned.has(person.id))
    const tasks = reply?.tasks ?? null
    const overWeeks = tasks
      ? weeksOverCapacity({
          rows: computeWorkload(tasks, {
            weeks,
            today,
            workingDays: (personId) => people.byId.get(personId)?.workingDays,
            daysOff
          }),
          people: working,
          weeks,
          daysOff
        }).map(({ personId, week, over }) => ({ personId, week, over }))
      : []
    return {
      show,
      loading: show && reply === null,
      error: reply?.error ?? null,
      overWeeks,
      noCapacityCount: working.filter((person) => person.weeklyCapacityHours === null).length
    }
  }, [show, reply, counted, people.all, people.byId, weeks, today, daysOff])
}
