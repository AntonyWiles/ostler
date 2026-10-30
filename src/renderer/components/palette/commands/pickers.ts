import type { SavedView, SearchResult, TaskTemplate } from '@shared/ostler-api'
import { joinSentences, t } from '@shared/i18n'
import { projectAndSubprojectName } from '@shared/subproject-label'
import { taskIdLabel } from '@shared/task-key'
import { Layers, LayoutTemplate, Search, Sparkles, Target, Timer } from '../../../ui/icons'
import { viewContext } from '../../../navigation/features'
import { allProjectViews } from '../../../navigation/registry'
import { projectPath, searchPath } from '../../../navigation/paths'
import { SEARCH_TYPES, searchResultPath } from '../../../views/search/search-results'
import type { PinTarget } from '../../../pins/PinsProvider'
import type { Command, PaletteContext } from './types'

/** A finished content search: the text it ran for and what it found. */
export interface FoundResults {
  query: string
  results: SearchResult[]
}

type PickerContext = Pick<
  PaletteContext,
  | 'projects'
  | 'navigate'
  | 'close'
  | 'askOstler'
  | 'timer'
  | 'focus'
  | 'pins'
  | 'features'
  | 'currentProject'
>

/** Content results, grouped by type in the order search ranks the types' best. */
export function buildContentCommands(
  ctx: Pick<PickerContext, 'projects' | 'navigate' | 'close' | 'askOstler'>,
  trimmed: string,
  found: FoundResults,
  subprojectName: (id: string | null | undefined) => string | null
): Command[] {
  if (!trimmed || found.query !== trimmed) return []
  const groups = new Map<string, Command[]>()
  for (const result of found.results) {
    const kind = SEARCH_TYPES[result.type]
    const project = ctx.projects.find((candidate) => candidate.id === result.projectId)
    const place = project
      ? projectAndSubprojectName(project.name, subprojectName(result.subprojectId))
      : ''
    const entry: Command = {
      id: `found:${result.type}:${result.id}`,
      group: kind.group,
      label:
        result.type === 'comment'
          ? t('navigation:commandPalette.comment', { resultTitle: result.title })
          : result.title,
      icon: kind.icon,
      // A task's ID (N9.8a) beside its project's name.
      hint: joinSentences([
        result.inTriage && t('tasks:triage.badge'),
        result.key
          ? t('tasks:taskId.withProject', { id: taskIdLabel(result.key), project: place })
          : place || undefined
      ]),
      snippet: result.snippet,
      run: () => {
        ctx.navigate(searchResultPath(result))
        ctx.close()
      }
    }
    groups.set(kind.group, [...(groups.get(kind.group) ?? []), entry])
  }
  return [
    ...[...groups.values()].flat(),
    {
      id: 'see-all',
      group: t('navigation:commandPalette.search'),
      label: t('navigation:commandPalette.seeAllResults', { trimmed }),
      icon: Search,
      run: () => {
        ctx.navigate(searchPath(trimmed))
        ctx.close()
      }
    },
    // What was typed, as a question for Ostler AI (N8.3a).
    ...(ctx.askOstler.available
      ? [
          {
            id: 'ask-ostler:typed',
            group: t('navigation:commandPalette.search'),
            label: t('ai:askOstler.paletteAskAbout', { question: trimmed }),
            icon: Sparkles,
            run: () => {
              ctx.close()
              ctx.askOstler.open(trimmed)
            }
          }
        ]
      : [])
  ]
}

/** The found tasks, for the timer and focus pickers. */
function foundTasks(trimmed: string, found: FoundResults): SearchResult[] {
  if (!trimmed || found.query !== trimmed) return []
  return found.results.filter((result) => result.type === 'task')
}

/** The task picker's results: starting a timer on one closes the palette. */
export function buildTimerCommands(
  ctx: Pick<PickerContext, 'projects' | 'close' | 'timer'>,
  trimmed: string,
  found: FoundResults
): Command[] {
  return foundTasks(trimmed, found).map((result) => ({
    id: `timer-task:${result.id}`,
    group: t('tasks:time.startTimerOn'),
    label: result.title,
    icon: Timer,
    hint: ctx.projects.find((candidate) => candidate.id === result.projectId)?.name,
    run: () => {
      ctx.close()
      void ctx.timer.start(result.projectId, result.id)
    }
  }))
}

/** "Focus on…" (N3.5): picking a task closes the palette and asks for the length. */
export function buildFocusCommands(
  ctx: Pick<PickerContext, 'projects' | 'close' | 'focus'>,
  trimmed: string,
  found: FoundResults
): Command[] {
  return foundTasks(trimmed, found).map((result) => ({
    id: `focus-task:${result.id}`,
    group: t('tasks:focus.focusOn'),
    label: result.title,
    icon: Target,
    hint: ctx.projects.find((candidate) => candidate.id === result.projectId)?.name,
    run: () => {
      ctx.close()
      ctx.focus.ask({ projectId: result.projectId, workItemId: result.id, title: result.title })
    }
  }))
}

/** The task template picker (N2.1): choosing one opens New task, filled from it. */
export function buildTemplateCommands(
  ctx: Pick<PickerContext, 'currentProject' | 'navigate' | 'close'>,
  trimmed: string,
  taskTemplates: TaskTemplate[]
): Command[] {
  const { currentProject } = ctx
  if (!currentProject) return []
  const needle = trimmed.toLowerCase()
  return taskTemplates
    .filter((template) => !needle || template.name.toLowerCase().includes(needle))
    .map((template) => ({
      id: `task-template:${template.id}`,
      group: t('navigation:commandPalette.newTaskFromTemplate'),
      label: template.name,
      icon: LayoutTemplate,
      hint:
        template.projectId === null ? t('tasks:taskTemplates.everyProject') : currentProject.name,
      run: () => {
        ctx.navigate(
          projectPath(currentProject.id, undefined, { newTask: '1', taskTemplate: template.id })
        )
        ctx.close()
      }
    }))
}

/** The "Pin…" picker (N5.2a): an item or view to pin to the sidebar. */
export function buildPinPickCommands(
  ctx: Pick<PickerContext, 'projects' | 'close' | 'pins' | 'features' | 'currentProject'>,
  trimmed: string,
  found: FoundResults,
  savedViews: SavedView[]
): Command[] {
  const { currentProject } = ctx
  const needle = trimmed.toLowerCase()
  const group = t('common:pins.pinToSidebar')
  const projectName = (id: string | null) => ctx.projects.find((p) => p.id === id)?.name
  const pinIt = (target: PinTarget) => () => {
    ctx.close()
    void ctx.pins.pin('sidebar', target)
  }
  const fromSearch: Command[] =
    trimmed && found.query === trimmed
      ? found.results.flatMap((result): Command[] =>
          result.type === 'task' ||
          result.type === 'milestone' ||
          result.type === 'decision' ||
          result.type === 'library'
            ? [
                {
                  id: `pin-pick:${result.type}:${result.id}`,
                  group,
                  label: result.title,
                  icon: SEARCH_TYPES[result.type].icon,
                  hint: projectName(result.projectId),
                  run: pinIt({
                    kind: result.type,
                    targetId: result.id,
                    projectId: result.projectId,
                    title: result.title
                  })
                }
              ]
            : []
        )
      : []
  const views: Command[] = savedViews
    .filter((view) => view.projectId && (!needle || view.name.toLowerCase().includes(needle)))
    .map((view) => ({
      id: `pin-pick:saved-view:${view.id}`,
      group,
      label: view.name,
      icon: Layers,
      hint: projectName(view.projectId),
      run: pinIt({
        kind: 'saved-view',
        targetId: view.id,
        projectId: view.projectId!,
        title: view.name
      })
    }))
  const tabs: Command[] = currentProject
    ? allProjectViews(viewContext(ctx.features, currentProject))
        .filter((view) => !needle || view.label.toLowerCase().includes(needle))
        .map((view) => ({
          id: `pin-pick:project-view:${view.id}`,
          group,
          label: `${currentProject.name}: ${view.label}`,
          icon: view.icon,
          run: pinIt({
            kind: 'project-view',
            targetId: view.id,
            projectId: currentProject.id,
            title: view.label
          })
        }))
    : []
  return [...fromSearch, ...views, ...tabs]
}
