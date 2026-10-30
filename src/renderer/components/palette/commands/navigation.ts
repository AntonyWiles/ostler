import { keywordList, t } from '@shared/i18n'
import {
  AppWindow,
  Bug,
  Copy,
  FileDown,
  Gift,
  Keyboard,
  Printer,
  Signpost,
  type LucideIcon
} from '../../../ui/icons'
import { viewContext } from '../../../navigation/features'
import { globalViews } from '../../../navigation/registry'
import { shortcut } from '../../../navigation/shortcuts'
import {
  contactsPath,
  goalsPath,
  helpPath,
  homePath,
  inboxPath,
  myWorkPath,
  projectPath,
  searchPath,
  settingsPath,
  teamPath,
  timelineOverviewPath,
  timesheetPath,
  undoHistoryPath,
  weeklyReviewPath,
  workloadPath
} from '../../../navigation/paths'
import { describePopOutRoute } from '../../../shell/pop-out'
import { agentsDestination } from '../../Sidebar'
import { closing, type Command, type PaletteContext } from './types'

/** Print or save My week, and Your year (N3.6) while Show my progress is on. */
export function buildPrintCommands(ctx: PaletteContext): Command[] {
  const group = t('navigation:commandPalette.print')
  const list: Command[] = []
  for (const output of ['printer', 'pdf'] as const) {
    list.push({
      id: `print-my-week:${output}`,
      group,
      label: t(output === 'printer' ? 'views:myWeek.print' : 'views:myWeek.savePdf'),
      icon: output === 'printer' ? Printer : FileDown,
      keywords: keywordList('navigation:commandPalette.keywords.printMyWeek'),
      run: closing(ctx, () => ctx.printMyWeek(output))
    })
  }
  if (ctx.showProgress) {
    for (const output of ['printer', 'pdf'] as const) {
      list.push({
        id: `print-year-in-review:${output}`,
        group,
        label: t(output === 'printer' ? 'views:yearInReview.print' : 'views:yearInReview.savePdf'),
        icon: output === 'printer' ? Printer : FileDown,
        keywords: keywordList('navigation:commandPalette.keywords.printYearInReview'),
        run: closing(ctx, () => ctx.printYearInReview(new Date().getFullYear(), output))
      })
    }
  }
  return list
}

/** Where each global view lives; Agents goes wherever agents are at work. */
const GLOBAL_VIEW_PATHS: Record<string, () => string> = {
  home: homePath,
  inbox: inboxPath,
  'my-work': myWorkPath,
  settings: () => settingsPath(),
  search: () => searchPath(),
  timesheet: timesheetPath,
  workload: workloadPath,
  team: teamPath,
  'weekly-review': weeklyReviewPath,
  'timeline-overview': timelineOverviewPath,
  contacts: contactsPath,
  goals: goalsPath,
  'undo-history': undoHistoryPath,
  help: () => helpPath()
}

/** Open in new window (N5.8a), then every global view. */
export function buildNavigationCommands(ctx: PaletteContext): Command[] {
  const { currentProject, currentView, projects } = ctx
  const group = t('navigation:commandPalette.go')
  const list: Command[] = []

  // Open in new window (N5.8a): Home, and the project view on show.
  const popOuts: { route: string; view: string }[] = [
    { route: homePath(), view: t('navigation:popOut.home') }
  ]
  if (currentProject && currentView) {
    const route = projectPath(currentProject.id, currentView)
    popOuts.push({ route, view: describePopOutRoute(route, projects) })
  }
  for (const popOut of popOuts) {
    list.push({
      id: `pop-out:${popOut.route}`,
      group,
      label: t('navigation:popOut.paletteOpen', { view: popOut.view }),
      icon: AppWindow,
      keywords: keywordList('navigation:popOut.paletteKeywords'),
      run: closing(ctx, () => ctx.openInNewWindow(popOut.route))
    })
  }

  for (const view of globalViews(viewContext(ctx.features, null), 'all')) {
    const to =
      GLOBAL_VIEW_PATHS[view.id]?.() ??
      agentsDestination(projects, currentProject?.id ?? null, ctx.activity.byProject)
    const keys = 'shortcut' in view && view.shortcut ? shortcut(view.shortcut) : undefined
    list.push({
      id: `global:${view.id}`,
      group,
      label: view.label,
      icon: view.icon,
      // A shortcut a later package builds is not offered yet.
      keys: keys && !keys.since ? keys.keys : undefined,
      keywords: view.keywords,
      run: ctx.go(to)
    })
  }
  return list
}

/** Shortcuts, what's new, reporting a problem, diagnostics and the tour. */
export function buildHelpCommands(ctx: PaletteContext): Command[] {
  const { help, tips } = ctx
  if (!help) return []
  const helpCommands: [string, string, LucideIcon, string[], () => void, string?][] = [
    [
      'help:shortcuts',
      t('navigation:commandPalette.keyboardShortcuts'),
      Keyboard,
      keywordList('navigation:commandPalette.keywords.shortcuts'),
      help.showShortcuts,
      shortcut('shortcut-help').keys
    ],
    [
      'help:whats-new',
      t('navigation:commandPalette.whatSNew'),
      Gift,
      keywordList('navigation:commandPalette.keywords.whatsNew'),
      help.showWhatsNew
    ],
    [
      'help:report',
      t('navigation:commandPalette.reportProblem'),
      Bug,
      keywordList('navigation:commandPalette.keywords.report'),
      () => void help.reportProblem()
    ],
    [
      'help:diagnostics',
      t('navigation:commandPalette.copyDiagnostics'),
      Copy,
      keywordList('navigation:commandPalette.keywords.diagnostics'),
      () => void help.copyDiagnostics()
    ],
    ...(tips
      ? [
          [
            'help:tour',
            t('navigation:commandPalette.takeTheTour'),
            Signpost,
            keywordList('navigation:commandPalette.keywords.tour'),
            tips.startTour
          ] as [string, string, LucideIcon, string[], () => void]
        ]
      : [])
  ]
  return helpCommands.map(([id, label, icon, keywords, run, keys]) => ({
    id,
    group: t('navigation:commandPalette.help'),
    label,
    icon,
    keys,
    keywords,
    run: closing(ctx, run)
  }))
}
