import type {
  PlanningSubproject,
  RendererProject,
  SavedView,
  SearchSnippetPart
} from '@shared/ostler-api'
import type { ProjectArea } from '@shared/project-areas'
import type { LucideIcon } from '../../../ui/icons'
import type { projectPath } from '../../../navigation/paths'
import type { useFeatures } from '../../../navigation/features'
import type { useAgentActivity } from '../../../shell/AgentActivity'
import type { useQuickAdd } from '../../quick-add/QuickAddProvider'
import type { useAskOstler } from '../../ask-ostler/AskOstlerProvider'
import type { useOptionalHelp } from '../../../help/HelpProvider'
import type { useOptionalTips } from '../../../tips/TipsProvider'
import type { useToast } from '../../../ui'
import type { useTimer } from '../../../time/TimerProvider'
import type { useFocus } from '../../../time/FocusProvider'
import type { usePins } from '../../../pins/PinsProvider'
import type { useOpenPin } from '../../../pins/useOpenPin'
import type { useOpenDemoProject } from '../../../hooks/useOpenDemoProject'
import type { useRemoveDemoProjects } from '../../project-care/useRemoveDemoProjects'
import type { usePrintMyWeek } from '../../../hooks/usePrintMyWeek'
import type { usePrintYearInReview } from '../../../hooks/usePrintYearInReview'
import type { useOpenInNewWindow } from '../../../shell/pop-out'

export interface Command {
  id: string
  /** Grouping label shown once above its run of results. */
  group: string
  label: string
  icon: LucideIcon
  /** A keyboard shortcut that does the same, as Kbd shows it. */
  keys?: string
  /** Right-aligned context: a project name, a status, a path. */
  hint?: string
  /** Extra words the search matches. */
  keywords?: readonly string[]
  /** Shown only when the search has text (records, and every project's views). */
  searchOnly?: boolean
  /** A content search result: shown whatever its label says, with its snippet. */
  snippet?: SearchSnippetPart[]
  run: () => void
}

/** What the palette is picking: everything, or one kind of thing. */
export type PaletteMode = 'all' | 'timer' | 'focus' | 'template' | 'pin'

/** Everything the command builders read, gathered once per build. */
export interface PaletteContext {
  projects: RendererProject[]
  areas: ProjectArea[] | undefined
  subprojectsByProject: ReadonlyMap<string, PlanningSubproject[]>
  savedViews: SavedView[]
  features: ReturnType<typeof useFeatures>
  currentProject: RendererProject | null
  currentView: Parameters<typeof projectPath>[1] | null
  activity: ReturnType<typeof useAgentActivity>
  quickAdd: ReturnType<typeof useQuickAdd>
  toast: ReturnType<typeof useToast>['toast']
  askOstler: ReturnType<typeof useAskOstler>
  help: ReturnType<typeof useOptionalHelp>
  tips: ReturnType<typeof useOptionalTips>
  timer: ReturnType<typeof useTimer>
  focus: ReturnType<typeof useFocus>
  pins: ReturnType<typeof usePins>
  openPin: ReturnType<typeof useOpenPin>
  openDemoProject: ReturnType<typeof useOpenDemoProject>
  removeDemoProjects: ReturnType<typeof useRemoveDemoProjects>
  printMyWeek: ReturnType<typeof usePrintMyWeek>
  printYearInReview: ReturnType<typeof usePrintYearInReview>
  showProgress: boolean
  openInNewWindow: ReturnType<typeof useOpenInNewWindow>
  onNewProject: () => void
  navigate: (to: string) => void
  /** Closes the palette. */
  close: () => void
  /** A run that goes to a route and closes the palette. */
  go: (to: string) => () => void
  /** Turns the palette into a picker of one kind of thing. */
  pick: (mode: Exclude<PaletteMode, 'all'>) => void
}

/** A run that closes the palette first, then does its work. */
export function closing(ctx: PaletteContext, run: () => unknown): () => void {
  return () => {
    ctx.close()
    void run()
  }
}
