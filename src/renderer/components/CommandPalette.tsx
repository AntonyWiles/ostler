import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { SavedView, SearchResult, TaskTemplate } from '@shared/ostler-api'
import { useOstler } from '../context/OstlerContext'
import { useFeatures } from '../navigation/features'
import { parseAppPath } from '../navigation/paths'
import { recordGettingStarted } from '../help/record-getting-started'
import { useOptionalHelp } from '../help/HelpProvider'
import { useOptionalTips } from '../tips/TipsProvider'
import { Snippet } from '../views/search/search-results'
import { useQuickAdd } from './quick-add/QuickAddProvider'
import { useAskOstler } from './ask-ostler/AskOstlerProvider'
import { useAgentActivity } from '../shell/AgentActivity'
import { useOpenDemoProject } from '../hooks/useOpenDemoProject'
import { useRemoveDemoProjects } from './project-care/useRemoveDemoProjects'
import { usePrintMyWeek } from '../hooks/usePrintMyWeek'
import { usePrintYearInReview } from '../hooks/usePrintYearInReview'
import { useShowProgress } from '../hooks/useShowProgress'
import { PERF_MARKS } from '@shared/perf-marks'
import { markPerf, useRenderedMark } from '../lib/perf-marks'
import { Dialog, Kbd, SearchField, useToast } from '../ui'
import { Icon } from '../ui/icons'
import { useTimer } from '../time/TimerProvider'
import { useFocus } from '../time/FocusProvider'
import { usePins } from '../pins/PinsProvider'
import { useOpenPin } from '../pins/useOpenPin'
import './CommandPalette.css'
import { t } from '@shared/i18n'
import { useAllSubprojects } from '../hooks/useAllSubprojects'
import { useOpenInNewWindow } from '../shell/pop-out'
import { parseTaskKey, taskKey } from '@shared/task-key'
import {
  buildContentCommands,
  buildFocusCommands,
  buildPaletteCommands,
  buildPinPickCommands,
  buildTemplateCommands,
  buildTimerCommands,
  type Command,
  type PaletteMode
} from './palette/commands'

/** How long typing settles before the content search runs. */
const SEARCH_DELAY_MS = 120

/** The id of the task result whose ID (N9.8a) is the one typed, or null. */
function keyResultId(
  results: SearchResult[],
  typed: { prefix: string; number: number }
): string | null {
  const key = taskKey(typed.prefix, typed.number)
  return results.find((result) => result.type === 'task' && result.key === key)?.id ?? null
}
/** Content results the palette shows; "See all results" has the rest. */
const CONTENT_LIMIT = 15

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opens the new-project wizard. */
  onNewProject: () => void
}

/**
 * Ctrl+K: jump to any view, project, setting or saved view, find any task,
 * comment, decision, milestone, goal or Library item by its words (P5.7), or
 * start a new task or project. Pins come first (N5.2a), and "Pin…" pins
 * something to the sidebar. Its entries come from the navigation
 * registry; content results come from the search index, grouped by type with
 * the matching words marked, and "See all results" opens the search page.
 */
export function CommandPalette({ open, onOpenChange, onNewProject }: CommandPaletteProps) {
  const { projects, areas } = useOstler()
  // Workstreams are read only while the palette is open.
  const { byProject: subprojectsByProject, subprojectById } = useAllSubprojects(
    open ? projects.map((project) => project.id) : []
  )
  const features = useFeatures()
  const activity = useAgentActivity()
  const quickAdd = useQuickAdd()
  const { toast } = useToast()
  const askOstler = useAskOstler()
  const openDemoProject = useOpenDemoProject()
  const removeDemoProjects = useRemoveDemoProjects()
  const printMyWeek = usePrintMyWeek()
  const printYearInReview = usePrintYearInReview()
  const showProgress = useShowProgress()
  const help = useOptionalHelp()
  const tips = useOptionalTips()
  const navigate = useNavigate()
  const location = useLocation()
  const setOpen = onOpenChange
  // "Find something with Ctrl+K" on Home's getting-started checklist (P8.1).
  useEffect(() => {
    if (open) recordGettingStarted('usedSearch')
  }, [open])
  const [query, setQuery] = useState('')
  // "Start timer on…" (R2.3) turns the palette into a task picker.
  // "New task from template…" (N2.1) turns it into a task template picker.
  // "Pin…" (N5.2a) turns it into a picker of things to pin to the sidebar.
  const [mode, setMode] = useState<PaletteMode>('all')
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([])
  const timer = useTimer()
  const focus = useFocus()
  const pins = usePins()
  const openPin = useOpenPin()
  const [activeIndex, setActiveIndex] = useState(0)
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [found, setFound] = useState<{ query: string; results: SearchResult[] }>({
    query: '',
    results: []
  })
  useRenderedMark(PERF_MARKS.searchResultsShown, open && found.query !== '', found.query)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeRef = useRef<HTMLLIElement>(null)
  const listId = useId()

  // Saved views are fetched when the palette opens rather than kept in sync:
  // the palette is short-lived, and a stale list is worse than a quick query.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setMode('all')
    setActiveIndex(0)
    setFound({ query: '', results: [] })
    let cancelled = false
    void window.ostlerAPI.listSavedViews().then((result) => {
      if (!cancelled) setSavedViews(result.ok ? result.value : [])
    })
    return () => {
      cancelled = true
    }
  }, [open, projects])

  // Content search, once typing settles.
  const trimmed = query.trim()
  useEffect(() => {
    if (!open || !trimmed || mode === 'template') return
    let cancelled = false
    const timer = setTimeout(() => {
      markPerf(PERF_MARKS.searchStarted, { key: trimmed })
      void window.ostlerAPI
        .search(trimmed, {
          limit: CONTENT_LIMIT,
          ...(mode === 'timer' || mode === 'focus' ? { types: ['task' as const] } : {}),
          ...(mode === 'pin'
            ? {
                types: [
                  'task' as const,
                  'milestone' as const,
                  'decision' as const,
                  'library' as const
                ]
              }
            : {})
        })
        .then((result) => {
          if (!cancelled) setFound({ query: trimmed, results: result.ok ? result.value : [] })
        })
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, trimmed, mode])

  const close = () => setOpen(false)

  const here = parseAppPath(location.pathname)
  const currentProjectId = here && 'projectId' in here ? here.projectId : null
  const currentProject = projects.find((project) => project.id === currentProjectId) ?? null
  const currentView = here?.kind === 'project' ? here.view : null
  const openInNewWindow = useOpenInNewWindow()

  // Built only while the palette is open: closed, it still re-renders on every
  // project and view switch (it reads the route), and building every
  // project's views and settings then cost each switch tens of milliseconds.
  const pick = (next: Exclude<PaletteMode, 'all'>) => {
    setMode(next)
    setQuery('')
    setFound({ query: '', results: [] })
    setActiveIndex(0)
    if (next === 'template' && currentProject) {
      setTaskTemplates([])
      void window.ostlerAPI.getTaskTemplates(currentProject.id).then((result) => {
        setTaskTemplates(result.ok ? result.value : [])
      })
    }
    inputRef.current?.focus()
  }

  // Built only while the palette is open: closed, it still re-renders on every
  // project and view switch (it reads the route), and building every
  // project's views and settings then cost each switch tens of milliseconds.
  const commands = useMemo<Command[]>(() => {
    if (!open) return []
    return buildPaletteCommands({
      projects,
      areas,
      subprojectsByProject,
      savedViews,
      features,
      currentProject,
      currentView,
      activity,
      quickAdd,
      toast,
      askOstler,
      help,
      tips,
      timer,
      focus,
      pins,
      openPin,
      openDemoProject,
      removeDemoProjects,
      printMyWeek,
      printYearInReview,
      showProgress,
      openInNewWindow,
      onNewProject,
      navigate,
      close: () => setOpen(false),
      go: (to) => () => {
        navigate(to)
        setOpen(false)
      },
      pick
    })
  }, [
    open,
    projects,
    subprojectsByProject,
    areas,
    savedViews,
    navigate,
    features,
    currentProject,
    currentView,
    openInNewWindow,
    activity.byProject,
    openDemoProject,
    removeDemoProjects,
    printMyWeek,
    printYearInReview,
    showProgress,
    help,
    tips,
    timer,
    focus,
    askOstler,
    pins,
    openPin
  ])

  const pickerCtx = {
    projects,
    navigate,
    close: () => setOpen(false),
    askOstler,
    timer,
    focus,
    pins,
    features,
    currentProject
  }
  const contentCommands = useMemo<Command[]>(
    () => buildContentCommands(pickerCtx, trimmed, found, (id) => subprojectById(id)?.name ?? null),
    [trimmed, found, projects, subprojectById, navigate, setOpen, askOstler]
  )
  const timerCommands = useMemo<Command[]>(
    () => (mode === 'timer' ? buildTimerCommands(pickerCtx, trimmed, found) : []),
    [mode, trimmed, found, projects, setOpen, timer]
  )
  const focusCommands = useMemo<Command[]>(
    () => (mode === 'focus' ? buildFocusCommands(pickerCtx, trimmed, found) : []),
    [mode, trimmed, found, projects, setOpen, focus]
  )
  const templateCommands = useMemo<Command[]>(
    () => (mode === 'template' ? buildTemplateCommands(pickerCtx, trimmed, taskTemplates) : []),
    [mode, trimmed, taskTemplates, currentProject, navigate, setOpen]
  )
  const pinPickCommands = useMemo<Command[]>(
    () => (mode === 'pin' ? buildPinPickCommands(pickerCtx, trimmed, found, savedViews) : []),
    [mode, trimmed, found, savedViews, currentProject, features, projects, pins, setOpen]
  )

  const results = useMemo(() => {
    if (mode === 'pin') return pinPickCommands
    if (mode === 'timer') return timerCommands
    if (mode === 'focus') return focusCommands
    if (mode === 'template') return templateCommands
    const needle = query.trim().toLowerCase()
    // No query: navigation only; records and every project's views would
    // otherwise bury it.
    if (!needle) return commands.filter((command) => !command.searchOnly).slice(0, 40)
    const matches = commands.filter((command) =>
      [command.label, command.hint ?? '', ...(command.keywords ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
    // A typed task ID (N9.8a) puts its task first, so Enter opens it.
    const typedKey = parseTaskKey(trimmed)
    const keyHit = typedKey
      ? contentCommands.find(
          (command) =>
            command.id === `found:task:${keyResultId(found.results, typedKey)}` &&
            found.query === trimmed
        )
      : undefined
    if (keyHit)
      return [keyHit, ...matches.slice(0, 25), ...contentCommands.filter((c) => c !== keyHit)]
    return [...matches.slice(0, 25), ...contentCommands]
  }, [
    trimmed,
    found,
    commands,
    contentCommands,
    query,
    mode,
    timerCommands,
    focusCommands,
    templateCommands,
    pinPickCommands
  ])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  const onInputKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (results.length ? (index + 1) % results.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) =>
        results.length ? (index - 1 + results.length) % results.length : 0
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      results[activeIndex]?.run()
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`
  const needle = query.trim()

  let lastGroup = ''
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('navigation:commandPalette.commandPalette')}
      className="palette"
      initialFocusRef={inputRef}
      footer={
        <div className="palette__keys" aria-hidden="true">
          <span>
            <Kbd shortcut="↑" /> <Kbd shortcut="↓" /> {t('navigation:commandPalette.move')}
          </span>
          <span>
            <Kbd shortcut="Enter" /> {t('navigation:commandPalette.open')}
          </span>
          <span>
            <Kbd shortcut="Esc" /> {t('navigation:commandPalette.close')}
          </span>
        </div>
      }
    >
      <SearchField
        ref={inputRef}
        label={t('navigation:commandPalette.commandPaletteSearch')}
        placeholder={
          mode === 'focus'
            ? t('tasks:focus.findTask')
            : mode === 'timer'
              ? t('tasks:time.findTaskToTime')
              : mode === 'template'
                ? t('navigation:commandPalette.findTaskTemplate')
                : mode === 'pin'
                  ? t('common:pins.paletteFindToPin')
                  : t('navigation:commandPalette.goProjectViewSetting')
        }
        value={query}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={results[activeIndex] ? optionId(activeIndex) : undefined}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={onInputKeyDown}
      />
      <ul
        id={listId}
        className="palette__results"
        role="listbox"
        aria-label={t('navigation:commandPalette.results')}
      >
        {results.length === 0 && (
          <li className="palette__empty" role="presentation">
            {(mode === 'timer' || mode === 'focus') && !trimmed
              ? t('tasks:time.typeTaskName')
              : mode === 'template' && !trimmed
                ? t('navigation:commandPalette.noTaskTemplates')
                : t('navigation:commandPalette.noMatches')}
          </li>
        )}
        {results.map((command, index) => {
          const heading = command.group === lastGroup ? null : command.group
          lastGroup = command.group
          return (
            <Fragment key={command.id}>
              {heading && (
                <li className="palette__group" role="presentation">
                  {heading}
                </li>
              )}
              <li
                id={optionId(index)}
                ref={index === activeIndex ? activeRef : undefined}
                role="option"
                aria-selected={index === activeIndex}
                className="palette__item"
                onMouseMove={() => setActiveIndex(index)}
                onClick={command.run}
              >
                <Icon icon={command.icon} className="palette__icon" />
                {command.snippet ? (
                  <span className="palette__found">
                    <span className="palette__label">
                      <Highlight text={command.label} needle={needle} />
                    </span>
                    {command.snippet.length > 0 && (
                      <span className="palette__snippet">
                        <Snippet parts={command.snippet} />
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="palette__label">
                    <Highlight text={command.label} needle={needle} />
                  </span>
                )}
                {command.hint && <span className="palette__hint">{command.hint}</span>}
                {command.keys && <Kbd shortcut={command.keys} className="palette__kbd" />}
              </li>
            </Fragment>
          )
        })}
      </ul>
    </Dialog>
  )
}

/** The text with each case-insensitive match of the search marked. */
export function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>
  // Lowercasing can change a character's length ("İ" becomes two), so each
  // position in the lowercased text keeps where its character starts and ends in `text`.
  let lower = ''
  const starts: number[] = []
  const ends: number[] = []
  let index = 0
  for (const char of text) {
    const lowered = char.toLowerCase()
    lower += lowered
    for (let unit = 0; unit < lowered.length; unit++) {
      starts.push(index)
      ends.push(index + char.length)
    }
    index += char.length
  }
  const target = needle.toLowerCase()
  const parts: Array<{ text: string; match: boolean }> = []
  let from = 0
  let fromLower = 0
  for (let at = lower.indexOf(target); at !== -1; at = lower.indexOf(target, fromLower)) {
    const start = Math.max(starts[at], from)
    const end = ends[at + target.length - 1]
    if (start > from) parts.push({ text: text.slice(from, start), match: false })
    if (end > start) parts.push({ text: text.slice(start, end), match: true })
    from = Math.max(end, from)
    fromLower = at + target.length
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false })
  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index}>{part.text}</mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        )
      )}
    </>
  )
}
