import { keywordList, t } from '@shared/i18n'
import { Bot, CalendarDays, LayoutTemplate, Megaphone, Plus, Replace } from '../../../ui/icons'
import { viewContext } from '../../../navigation/features'
import { allProjectViews, projectViews } from '../../../navigation/registry'
import { projectViewKeys, shortcut } from '../../../navigation/shortcuts'
import { projectPath, statusUpdatePath } from '../../../navigation/paths'
import { runPlaybookBlocker } from '../../../task-templates/RunPlaybookDialog'
import type { Command, PaletteContext } from './types'

/** The project on show: its views, then what can be made or done in it. */
export function buildCurrentProjectCommands(ctx: PaletteContext): Command[] {
  const { currentProject, features, go } = ctx
  if (!currentProject) return []
  const list: Command[] = []
  const group = currentProject.name
  const viewCtx = viewContext(features, currentProject)
  const tabs = projectViews(viewCtx)
  for (const view of allProjectViews(viewCtx)) {
    list.push({
      id: `current:${view.id}`,
      group,
      label: view.label,
      icon: view.icon,
      keys: projectViewKeys(tabs.findIndex((tab) => tab.id === view.id)),
      keywords: view.keywords,
      run: go(projectPath(currentProject.id, view.id))
    })
  }
  list.push({
    id: 'current:new-task',
    group,
    label: t('navigation:commandPalette.newTask'),
    icon: Plus,
    keywords: keywordList('navigation:commandPalette.keywords.create'),
    run: go(projectPath(currentProject.id, undefined, { newTask: '1' }))
  })
  list.push({
    id: 'current:new-task-from-template',
    group,
    label: t('navigation:commandPalette.newTaskFromTemplate'),
    icon: LayoutTemplate,
    keywords: keywordList('navigation:commandPalette.keywords.taskTemplate'),
    run: () => ctx.pick('template')
  })
  // Run playbook (N9.6b): only while agents are on; the dialog says why it can't run.
  if (features.agents)
    list.push({
      id: 'current:run-playbook',
      group,
      label: t('navigation:commandPalette.runPlaybook'),
      icon: Bot,
      hint: runPlaybookBlocker(true, currentProject) ?? undefined,
      keywords: keywordList('navigation:commandPalette.keywords.playbook'),
      run: go(projectPath(currentProject.id, undefined, { runPlaybook: '1' }))
    })
  list.push({
    id: 'current:plan-tasks',
    group,
    label: t('navigation:commandPalette.planTasks'),
    icon: Plus,
    keywords: keywordList('navigation:commandPalette.keywords.create'),
    run: go(projectPath(currentProject.id, undefined, { planTasks: '1' }))
  })
  list.push({
    id: 'current:find-replace',
    group,
    label: t('navigation:commandPalette.findReplace'),
    icon: Replace,
    keywords: keywordList('navigation:commandPalette.keywords.findReplace'),
    keys: shortcut('find-replace').keys,
    run: go(projectPath(currentProject.id, undefined, { findReplace: '1' }))
  })
  list.push({
    id: 'current:post-update',
    group,
    label: t('navigation:commandPalette.postUpdate'),
    icon: Megaphone,
    keywords: keywordList('navigation:commandPalette.keywords.statusUpdate'),
    run: go(statusUpdatePath(currentProject.id))
  })
  list.push({
    id: 'current:export-calendar-file',
    group,
    label: t('navigation:commandPalette.exportCalendarFile'),
    icon: CalendarDays,
    keywords: keywordList('navigation:commandPalette.keywords.calendarFile'),
    run: go(projectPath(currentProject.id, 'calendar', { exportCalendar: '1' }))
  })
  return list
}
