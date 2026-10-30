import { useState } from 'react'
import { t } from '@shared/i18n'
import type { ProjectViewProps } from '../../navigation/view-props'
import { SegmentedControl, Toolbar } from '../../ui'
import { Grid3x3, List } from '../../ui/icons'
import { ListView } from '../planning/list/ListView'
import { IdeaGrid } from '../planning/ideas/IdeaGrid'
import { TurnedDown } from '../planning/ideas/TurnedDown'
import '../planning/TaskToolbar.css'

type IdeasMode = 'list' | 'grid'

/** Where the Someday view remembers List or Grid, per project (a per-viewer convenience). */
const IDEAS_MODE_KEY = 'ostler.viewSettings.ideasMode'

function storedMode(projectId: string): IdeasMode {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(IDEAS_MODE_KEY) ?? '{}')
    return (value as Record<string, unknown>)?.[projectId] === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

function storeMode(projectId: string, mode: IdeasMode) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(IDEAS_MODE_KEY) ?? '{}')
    const next = { ...(value && typeof value === 'object' ? value : {}), [projectId]: mode }
    localStorage.setItem(IDEAS_MODE_KEY, JSON.stringify(next))
  } catch {
    // Storage full or blocked: the choice lasts until the view closes.
  }
}

/**
 * The project's Someday tasks (N1.1a), reached from its More menu: its ideas
 * (N1.1b). List is the List's table with one fixed filter and the ideas'
 * scores; Grid places them by impact and effort. Turned down, under both,
 * keeps the ideas closed as won't do with their reasons.
 */
export function SomedayTab({ ws }: ProjectViewProps) {
  const [mode, setMode] = useState<IdeasMode>(() => storedMode(ws.projectId))
  const choose = (next: IdeasMode) => {
    setMode(next)
    storeMode(ws.projectId, next)
  }
  const modes = (
    <SegmentedControl<IdeasMode>
      label={t('tasks:ideas.mode')}
      size="sm"
      value={mode}
      onChange={choose}
      options={[
        { value: 'list', label: t('tasks:ideas.list'), icon: List },
        { value: 'grid', label: t('tasks:ideas.grid'), icon: Grid3x3 }
      ]}
    />
  )
  const ideas = ws.workItems.filter((item) => item.someday)
  return (
    <div className="someday-view">
      {mode === 'list' ? (
        <ListView ws={ws} someday toolbarEnd={modes} />
      ) : (
        <>
          <Toolbar label={t('tasks:someday.viewTitle')} className="task-toolbar" end={modes}>
            <span className="task-toolbar__count" aria-live="polite">
              {t('tasks:someday.viewCount', { count: ideas.length })}
            </span>
          </Toolbar>
          <IdeaGrid ws={ws} ideas={ideas} />
        </>
      )}
      <TurnedDown ws={ws} />
    </div>
  )
}
