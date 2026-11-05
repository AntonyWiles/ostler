import type { PlanningWorkItem } from '@shared/ostler-api'
import { type PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import type { MenuEntry, MenuItem } from '../../ui'
import { STATUS_ICONS } from '../../ui'
import {
  Archive,
  Ban,
  CalendarClock,
  Bot,
  Copy,
  Eye,
  Flag,
  Lightbulb,
  ListPlus,
  PanelRightOpen,
  Play,
  Sparkles,
  Square,
  Target,
  Timer,
  Trash2,
  Undo2
} from '../../ui/icons'
import type { TimerApi } from '../../time/TimerProvider'
import type { FocusApi } from '../../time/FocusProvider'
import { t } from '@shared/i18n'
import { canCloseAsWontDo } from '@shared/planning/wont-do'
import { liveSubprojects, subprojectOptions } from './subproject-ui'

/**
 * A task's actions, for its card's right-click menu and its More menu: one
 * list, so both offer the same things. Agent and AI items appear only while
 * their feature is on (D10, D11). The rules about what may move, queue or be
 * deleted stay where they live (the workspace); this only offers them.
 */
export function taskMenuItems(
  item: PlanningWorkItem,
  ws: PlanningWorkspace,
  features: { agents: boolean; ai: boolean },
  timer?: TimerApi,
  focus?: FocusApi
): MenuEntry[] {
  const deletionBlocker = ws.deletionBlocker(item)
  const current = ws.projectedStatus(item)
  const linked = item.linkedHarnessTaskId !== null
  // Queued, not started: Blocked holds it, another column takes it out of the queue.
  const queuedOnly = linked && ws.harnessTaskFor(item)?.status === 'pending'

  const agentItems: MenuItem[] = []
  if (features.agents) {
    if (item.status === 'ready' && !linked) {
      agentItems.push({
        label: t('tasks:taskMenu.queueAgent'),
        icon: Bot,
        disabled: ws.busy,
        hint: ws.dependenciesComplete(item)
          ? t('tasks:taskMenu.addTaskAgentQueue')
          : t('tasks:taskMenu.waitsQueueStartsOwn'),
        onSelect: () => void ws.queueWorkItem(item)
      })
      // The run's own model (D42); plain Queue uses the project's default.
      agentItems.push({
        label: t('agents:runModel.queueWithModel'),
        icon: Bot,
        disabled: ws.busy,
        hint: t('agents:runModel.queueWithModelHint'),
        onSelect: () => ws.setRunModelTarget({ kind: 'queue', item })
      })
    }
    const position = ws.queuePositionOf(item)
    if (position === 0) {
      agentItems.push({
        label: t('tasks:taskMenu.runNow'),
        icon: Play,
        disabled: !ws.canStartAgent(item),
        hint: t('tasks:taskMenu.runTaskNowBuilt'),
        onSelect: () => void ws.startWorkItemAgent(item)
      })
    }
    // Always offered: a queued task copies its handoff, a running one its session's prompt,
    // and any other the automation-API prompt for working on it (nothing is queued).
    agentItems.push({
      label: t('tasks:taskMenu.copyAgentPrompt'),
      icon: Copy,
      hint:
        position >= 0
          ? t('tasks:taskMenu.copyWhatConnectedAgent')
          : t('tasks:taskMenu.copyPromptNotQueued'),
      onSelect: () => void ws.copyAgentHandoff(item)
    })
    const session = ws.sessionForWorkItem(item)
    if (session) {
      agentItems.push({
        label: t('tasks:taskMenu.watchAgentRun'),
        icon: Eye,
        hint: t('tasks:taskMenu.everyMessageToolCall'),
        onSelect: () => ws.setTranscriptSessionId(session.id)
      })
    }
  }

  return [
    {
      label: t('tasks:taskMenu.open'),
      icon: PanelRightOpen,
      onSelect: () => ws.openWorkItem(item)
    },
    // The timer (R2.3): one across Ostler, so starting here stops any other.
    ...(timer && !item.archivedAt && !item.deletedAt
      ? [
          timer.running?.workItemId === item.id
            ? {
                label: t('tasks:time.stopTimer'),
                icon: Square,
                onSelect: () => void timer.stop()
              }
            : {
                label: t('tasks:time.startTimer'),
                icon: Timer,
                hint: timer.running
                  ? t('tasks:time.stopsTimerOn', { task: timer.running.workItemTitle })
                  : undefined,
                onSelect: () => void timer.start(item.projectId, item.id)
              }
        ]
      : []),
    // Focus (N3.5): a countdown on the same timer.
    ...(focus && !item.archivedAt && !item.deletedAt
      ? [
          {
            label: t('tasks:focus.focusMenu'),
            icon: Target,
            onSelect: () =>
              focus.ask({ projectId: item.projectId, workItemId: item.id, title: item.title })
          }
        ]
      : []),
    ...(features.ai
      ? [
          {
            label: t('tasks:taskMenu.editAi'),
            icon: Sparkles,
            onSelect: () => void ws.improveSpecificWorkItem(item)
          }
        ]
      : []),
    {
      type: 'group',
      label: t('tasks:taskMenu.move'),
      items: ws.statusWords.places(ws.columnOf(item)).map(({ key, status, columnId, label }) => ({
        label,
        icon: STATUS_ICONS[status],
        disabled: ws.busy || (linked && !queuedOnly) || ws.columnOf(item) === key,
        hint: linked
          ? queuedOnly
            ? t('tasks:taskMenu.queuedAgentDragBlocked')
            : t('tasks:workItemDrawer.queuedAgentStatusFollows')
          : undefined,
        onSelect: () => void ws.moveWorkItem(item, status, columnId)
      }))
    },
    {
      type: 'group' as const,
      label: t('tasks:taskMenu.milestone'),
      items: [
        {
          label: t('tasks:taskMenu.noMilestone'),
          icon: Flag,
          disabled: ws.busy || item.milestoneId === null,
          onSelect: () => void ws.assignWorkItemMilestone(item, null)
        },
        ...ws.milestones.map((milestone) => ({
          label: milestone.name,
          icon: Flag,
          disabled: ws.busy || item.milestoneId === milestone.id,
          onSelect: () => void ws.assignWorkItemMilestone(item, milestone.id)
        }))
      ]
    },
    ...(liveSubprojects(ws.subprojects).length > 0
      ? [
          {
            type: 'group' as const,
            label: t('tasks:subprojects.moveTo'),
            items: subprojectOptions(ws.subprojects, item.subprojectId).map((option) => ({
              label: option.label,
              disabled:
                ws.busy ||
                option.disabled ||
                (option.value || null) === (item.subprojectId ?? null),
              onSelect: () =>
                void ws.updateWorkItemInline(item, { subprojectId: option.value || null })
            }))
          }
        ]
      : []),
    ...(agentItems.length > 0 ? [{ type: 'separator' as const }, ...agentItems] : []),
    { type: 'separator' },
    // My day (N1.4): picked for today, with undo in its toast.
    ...(!item.archivedAt && !item.deletedAt
      ? [
          {
            label: t('views:myDay.add'),
            icon: ListPlus,
            hint: t('views:myDay.addHint'),
            onSelect: () => void ws.addToMyDay(item)
          },
          // Time blocks (N3.4a): the keyboard way to put the task into the week.
          {
            label: t('views:timeBlocks.menu'),
            icon: CalendarClock,
            hint: t('views:timeBlocks.menuHint'),
            onSelect: () => ws.setBlockTimeTarget(item)
          }
        ]
      : []),
    // Someday (N1.1a): a flag, not a status, with undo in its toast.
    item.someday
      ? {
          label: t('tasks:someday.bringBack'),
          icon: Undo2,
          disabled: ws.busy,
          onSelect: () => void ws.setSomeday([item], false)
        }
      : {
          label: t('tasks:someday.moveTo'),
          icon: Lightbulb,
          disabled: ws.busy,
          hint: t('tasks:someday.moveToHint'),
          onSelect: () => void ws.setSomeday([item], true)
        },
    {
      label: t('tasks:taskMenu.archive'),
      icon: Archive,
      disabled: ws.busy || deletionBlocker !== null,
      hint:
        deletionBlocker?.replace('deleted', 'archived') ??
        t('tasks:taskMenu.moveTaskProjectArchive'),
      onSelect: () => void ws.archiveWorkItem(item)
    },
    // Won't do (N1.2): every unfinished task; running or in-review work refuses.
    ...(canCloseAsWontDo(item, current)
      ? [
          {
            label: t('tasks:wontDo.menu'),
            icon: Ban,
            disabled: ws.busy || ws.wontDoBlocker(item) !== null,
            hint: ws.wontDoBlocker(item) ?? t('tasks:wontDo.menuHint'),
            onSelect: () => ws.openWontDo([item])
          }
        ]
      : []),
    {
      label: t('tasks:taskMenu.moveRecycleBin'),
      icon: Trash2,
      tone: 'danger',
      disabled: ws.busy || deletionBlocker !== null,
      hint: deletionBlocker ?? t('tasks:taskMenu.restorable30Days'),
      onSelect: () => void ws.deleteWorkItem(item)
    }
  ]
}
