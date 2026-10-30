import type { JumpListCategory, JumpListItem } from 'electron'
import { deepLinkFor } from '@shared/deep-link'
import type { NavigateRequest } from '@shared/ostler-api'
import { t } from '@shared/i18n'

/**
 * The taskbar jump list (P8.2): New task and Inbox as tasks, and the recent
 * projects. Every entry starts Ostler with a deep link, so a running Ostler
 * receives it through `second-instance` and one that is not running opens on
 * it. Pure, so the list is testable.
 *
 * While a timer runs (R2.3), Stop timer is the first task. It is not a link
 * (a link only ever navigates): it starts Ostler with `STOP_TIMER_ARGUMENT`,
 * which the running Ostler receives the same way.
 *
 * Countdowns (N5.2b) come in their own category, before the recent projects:
 * "12 days to Launch", each opening its task or milestone through its link.
 */

/** The argument the jump list's Stop timer starts Ostler with. */
export const STOP_TIMER_ARGUMENT = '--stop-timer'

export interface JumpListOptions {
  /** The executable to start (`process.execPath`). */
  program: string
  /** Arguments before the link: none when packaged, the app path in development. */
  baseArgs: string[]
  scheme: string
  iconPath: string
  /** Most recent first; only projects that still exist and are not archived. */
  recentProjects: { id: string; name: string }[]
  /** A timer runs: offer Stop timer. */
  timerRunning?: boolean
  /** Countdowns, worded, with the item each opens (N5.2b); at most three. */
  countdowns?: readonly { label: string; request: NavigateRequest }[]
}

/** How many recent projects the list shows. */
export const JUMP_LIST_RECENT_PROJECTS = 5

/** Quotes an argument for a Windows command line when it needs it. */
export function quoteArgument(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

function linkTask(
  options: JumpListOptions,
  title: string,
  description: string,
  request: NavigateRequest
): JumpListItem {
  return {
    type: 'task',
    title,
    description,
    program: options.program,
    args: [...options.baseArgs, deepLinkFor(request, options.scheme)].map(quoteArgument).join(' '),
    iconPath: options.iconPath,
    iconIndex: 0
  }
}

/** A project name short enough for a jump-list title. */
function shortName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean
}

export function buildJumpList(options: JumpListOptions): JumpListCategory[] {
  const categories: JumpListCategory[] = [
    {
      type: 'tasks',
      items: [
        ...(options.timerRunning
          ? [
              {
                type: 'task' as const,
                title: t('desktop:jumpList.stopTimer'),
                description: t('desktop:jumpList.stopTheRunningTimer'),
                program: options.program,
                args: [...options.baseArgs, STOP_TIMER_ARGUMENT].map(quoteArgument).join(' '),
                iconPath: options.iconPath,
                iconIndex: 0
              }
            ]
          : []),
        linkTask(options, t('desktop:jumpList.newTask'), t('desktop:jumpList.quickAddTask'), {
          kind: 'quick-add'
        }),
        linkTask(options, t('desktop:jumpList.inbox'), t('desktop:jumpList.openInbox'), {
          kind: 'inbox'
        })
      ]
    }
  ]
  const countdowns = options.countdowns ?? []
  if (countdowns.length > 0) {
    categories.push({
      type: 'custom',
      name: t('desktop:jumpList.countdowns'),
      items: countdowns.map((countdown) =>
        linkTask(options, countdown.label, countdown.label, countdown.request)
      )
    })
  }
  const recent = options.recentProjects.slice(0, JUMP_LIST_RECENT_PROJECTS)
  if (recent.length > 0) {
    categories.push({
      type: 'custom',
      name: t('desktop:jumpList.recentProjects'),
      items: recent.map((project) =>
        linkTask(
          options,
          shortName(project.name),
          t('desktop:jumpList.openProject', { project: shortName(project.name) }),
          {
            kind: 'project',
            projectId: project.id,
            view: 'overview'
          }
        )
      )
    })
  }
  return categories
}

/**
 * The recent projects: those the person opened, most recent first, then the
 * newest-added of the rest. Only projects that exist and are not archived.
 */
export function recentProjects(
  projects: readonly { id: string; name: string; enabled: boolean; addedAt: number }[],
  openedIds: readonly string[]
): { id: string; name: string }[] {
  const live = projects.filter((project) => project.enabled)
  const opened = openedIds
    .map((id) => live.find((project) => project.id === id))
    .filter((project): project is (typeof live)[number] => project !== undefined)
  const rest = live
    .filter((project) => !openedIds.includes(project.id))
    .sort((a, b) => b.addedAt - a.addedAt)
  return [...opened, ...rest]
    .slice(0, JUMP_LIST_RECENT_PROJECTS)
    .map(({ id, name }) => ({ id, name }))
}
