import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PlanningWorkItemStatus, SavedView } from '@shared/ostler-api'
import { agentColumnsLocked } from '@shared/board-columns'
import { projectFolder } from '@shared/project-folder'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import { useFeatures } from '../../../navigation/features'
import { BOARD_SETTINGS_GROUP, settingsPath } from '../../../navigation/paths'
import { useProjectList } from '../../../context/OstlerContext'
import { ProjectColumnsManager } from '../../../components/ProjectColumnsManager'
import { openSettingsGroup } from '../../settings/settings-form'
import {
  Badge,
  Button,
  Drawer,
  IconButton,
  InlineAlert,
  NumberField,
  Tabs,
  useConfirm
} from '../../../ui'
import {
  Check,
  Globe,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Trash2,
  Undo2
} from '../../../ui/icons'
import { TaskFilterFields } from '../TaskFilterFields'
import { HiddenTasksNote } from '../HiddenTasksNote'
import { BoardTaskCount } from '../BoardToolbar'
import { SavedViewNameDialog } from '../ViewsMenu'
import { BoardViewOptionsFields } from './BoardViewOptionsFields'
import './BoardLayoutEditor.css'
import { t } from '@shared/i18n'

type Section = 'views' | 'options' | 'columns'

/**
 * Customise board: everything about the Board in one panel beside it, so each
 * change shows on the Board behind as it is made. The toolbar as it stands
 * (search and filters), the views (the project's, all projects', and the
 * defaults, with save, revert, rename, delete and reset), the view options,
 * and the columns with their names and work-in-progress limits.
 *
 * It holds no state of its own: every control reads and writes the Board's
 * view (`useTaskView`, saved views) and the project's columns, the same ones
 * the toolbar, View options and Project settings › Board use.
 */
export function BoardLayoutEditor({
  ws,
  open,
  onClose
}: {
  ws: PlanningWorkspace
  open: boolean
  onClose: () => void
}) {
  if (!open) return null
  return <BoardLayoutPanel ws={ws} onClose={onClose} />
}

function BoardLayoutPanel({ ws, onClose }: { ws: PlanningWorkspace; onClose: () => void }) {
  const [section, setSection] = useState<Section>('views')
  const view = ws.boardView
  const navigate = useNavigate()

  const toAllProjectsSettings = () => {
    openSettingsGroup(BOARD_SETTINGS_GROUP)
    onClose()
    navigate(settingsPath('projects'))
  }

  const panels: Record<Section, () => ReactNode> = {
    views: () => <ViewsPanel ws={ws} />,
    options: () => (
      <div className="board-layout__options task-view-options">
        <BoardViewOptionsFields ws={ws} />
      </div>
    ),
    columns: () => <ColumnsPanel ws={ws} />
  }

  return (
    <Drawer
      id="board-layout"
      open
      onClose={onClose}
      className="board-layout"
      title={t('tasks:boardLayout.title')}
      description={t('tasks:boardLayout.description')}
      footer={
        <>
          <Button variant="ghost" icon={Settings} onClick={toAllProjectsSettings}>
            {t('tasks:boardLayout.allProjectsSettings')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('tasks:boardLayout.done')}
          </Button>
        </>
      }
    >
      <ShowingLine ws={ws} />

      <section className="board-layout__toolbar" aria-labelledby="board-layout-toolbar">
        <h3 id="board-layout-toolbar" className="board-layout__heading">
          {t('tasks:boardLayout.toolbar')}
        </h3>
        <div className="board-layout__toolbar-row task-toolbar">
          <TaskFilterFields ws={ws} workItems={ws.workItems} filters={view} embedded />
        </div>
        <div className="board-layout__toolbar-end">
          <BoardTaskCount ws={ws} live={false} />
          <HiddenTasksNote hidden={ws.boardHidden} />
          {view.isFiltered && (
            <Button size="sm" variant="ghost" onClick={view.clear}>
              {t('tasks:boardLayout.clearFilters')}
            </Button>
          )}
        </div>
      </section>

      <Tabs
        label={t('tasks:boardLayout.sections')}
        className="board-layout__tabs"
        value={section}
        onChange={setSection}
        items={(['views', 'options', 'columns'] as const).map((value) => ({
          value,
          label: t(`tasks:boardLayout.section.${value}`),
          content: value === section ? panels[value]() : undefined
        }))}
      />
    </Drawer>
  )
}

/** Which view is showing, where it is kept, and Save or Revert while it has changed. */
function ShowingLine({ ws }: { ws: PlanningWorkspace }) {
  const view = ws.boardView
  const active = view.activeView
  const [error, setError] = useState<string | null>(null)
  const run = (action: () => Promise<void>) => {
    setError(null)
    action().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : t('tasks:viewsMenu.didNotWorkTry'))
    )
  }
  return (
    <div className="board-layout__showing" role="status">
      <div className="board-layout__showing-line">
        <span className="board-layout__showing-label">{t('tasks:boardLayout.showing')}</span>
        <strong>{active ? active.name : t('tasks:viewsMenu.defaultView')}</strong>
        <ScopeBadge view={active} />
        {view.isChanged && <Badge tone="warning">{t('tasks:boardLayout.changed')}</Badge>}
      </div>
      <p className="board-layout__showing-hint">
        {active
          ? view.isChanged
            ? t('tasks:boardLayout.namedChanged')
            : t('tasks:boardLayout.namedSaved')
          : t(`tasks:boardLayout.defaultFrom.${view.defaultSource}`)}
      </p>
      {active && view.isChanged && (
        <div className="board-layout__actions">
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            onClick={() => run(view.updateActive)}
          >
            {t('tasks:boardLayout.saveChanges')}
          </Button>
          <Button size="sm" variant="ghost" icon={Undo2} onClick={view.revert}>
            {t('tasks:viewsMenu.revert')}
          </Button>
        </div>
      )}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </div>
  )
}

function ScopeBadge({ view }: { view: SavedView | null }) {
  if (view?.projectId === null)
    return (
      <Badge tone="info" icon={Globe}>
        {t('tasks:viewsMenu.allProjects')}
      </Badge>
    )
  return <Badge>{t('tasks:viewsMenu.thisProject')}</Badge>
}

/**
 * The views: this project's default and named views, then all projects'
 * default and named views, each with what can be done to it, and what can
 * be done with what is showing (save as new, set as a default).
 */
function ViewsPanel({ ws }: { ws: PlanningWorkspace }) {
  const view = ws.boardView
  const active = view.activeView
  const confirm = useConfirm()
  const [naming, setNaming] = useState<
    null | { mode: 'save' } | { mode: 'rename'; view: SavedView }
  >(null)
  const [error, setError] = useState<string | null>(null)
  const run = (action: () => Promise<void>) => {
    setError(null)
    action().catch((caught: unknown) =>
      setError(caught instanceof Error ? caught.message : t('tasks:viewsMenu.didNotWorkTry'))
    )
  }
  const projectViews = view.views.filter((saved) => saved.projectId !== null)
  const sharedViews = view.views.filter((saved) => saved.projectId === null)

  const row = (saved: SavedView) => (
    <li key={saved.id} className="board-layout__view">
      <Button
        size="sm"
        variant={active?.id === saved.id ? 'secondary' : 'ghost'}
        aria-pressed={active?.id === saved.id}
        className="board-layout__view-name"
        onClick={() => view.selectView(saved.id)}
      >
        {saved.name}
      </Button>
      {active?.id === saved.id && view.isChanged && (
        <Badge tone="warning">{t('tasks:boardLayout.changed')}</Badge>
      )}
      <span className="board-layout__view-actions">
        <IconButton
          size="sm"
          icon={Pencil}
          label={t('tasks:boardLayout.renameView', { name: saved.name })}
          onClick={() => setNaming({ mode: 'rename', view: saved })}
        />
        <IconButton
          size="sm"
          icon={Trash2}
          variant="danger"
          label={t('tasks:boardLayout.deleteView', { name: saved.name })}
          onClick={() => run(() => view.remove(saved.id))}
        />
      </span>
    </li>
  )

  return (
    <div className="board-layout__views">
      <section aria-labelledby="board-layout-project-views">
        <h3 id="board-layout-project-views" className="board-layout__heading">
          {t('tasks:viewsMenu.thisProject')}
        </h3>
        <ul className="board-layout__view-list">
          <li className="board-layout__view">
            <Button
              size="sm"
              variant={active === null ? 'secondary' : 'ghost'}
              aria-pressed={active === null}
              className="board-layout__view-name"
              onClick={() => view.selectView(null)}
            >
              {t('tasks:viewsMenu.defaultView')}
            </Button>
            <span className="board-layout__view-note">
              {t(`tasks:boardLayout.defaultSource.${view.defaultSource}`)}
            </span>
            <span className="board-layout__view-actions">
              {view.defaultSource === 'project' && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={RotateCcw}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t('tasks:boardLayout.resetDefaultTitle'),
                      body: view.hasAllProjectsDefault
                        ? t('tasks:boardLayout.resetDefaultToAll')
                        : t('tasks:boardLayout.resetDefaultToStandard'),
                      confirmLabel: t('tasks:boardLayout.reset')
                    })
                    if (ok) run(view.resetDefault)
                  }}
                >
                  {t('tasks:boardLayout.resetToDefault')}
                </Button>
              )}
            </span>
          </li>
          {projectViews.map(row)}
        </ul>
      </section>

      <section aria-labelledby="board-layout-shared-views">
        <h3 id="board-layout-shared-views" className="board-layout__heading">
          {t('tasks:viewsMenu.allProjects')}
        </h3>
        <ul className="board-layout__view-list">
          <li className="board-layout__view">
            <span className="board-layout__view-label">
              {t('tasks:boardLayout.allProjectsDefault')}
            </span>
            <span className="board-layout__view-note">
              {view.hasAllProjectsDefault
                ? t('tasks:boardLayout.customised')
                : t('tasks:boardLayout.standard')}
            </span>
            <span className="board-layout__view-actions">
              {view.hasAllProjectsDefault && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={RotateCcw}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t('tasks:boardLayout.resetAllTitle'),
                      body: t('tasks:boardLayout.resetAllMessage'),
                      confirmLabel: t('tasks:boardLayout.reset')
                    })
                    if (ok) run(view.resetAllProjectsDefault)
                  }}
                >
                  {t('tasks:boardLayout.resetToStandard')}
                </Button>
              )}
            </span>
          </li>
          {sharedViews.map(row)}
        </ul>
        {sharedViews.length === 0 && (
          <p className="board-layout__hint">{t('tasks:boardLayout.noSharedViews')}</p>
        )}
      </section>

      <section aria-labelledby="board-layout-with-showing">
        <h3 id="board-layout-with-showing" className="board-layout__heading">
          {t('tasks:boardLayout.withShowing')}
        </h3>
        <div className="board-layout__actions board-layout__actions--column">
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => setNaming({ mode: 'save' })}
          >
            {t('tasks:viewsMenu.saveView2')}
          </Button>
          <Button size="sm" variant="ghost" icon={Check} onClick={() => run(view.setAsDefault)}>
            {t('tasks:viewsMenu.setDefaultProject')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Globe}
            onClick={() => run(view.setAsAllProjectsDefault)}
          >
            {t('tasks:boardLayout.setDefaultAll')}
          </Button>
        </div>
      </section>

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      <SavedViewNameDialog
        mode={naming?.mode ?? null}
        initialName={naming?.mode === 'rename' ? naming.view.name : ''}
        onClose={() => setNaming(null)}
        onSubmit={(name, scope) =>
          naming?.mode === 'rename' ? view.rename(naming.view.id, name) : view.saveAs(name, scope)
        }
      />
    </div>
  )
}

/** The project's columns (names, shown) and their work-in-progress limits. */
function ColumnsPanel({ ws }: { ws: PlanningWorkspace }) {
  const features = useFeatures()
  const project = useProjectList().find((candidate) => candidate.id === ws.projectId)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="board-layout__columns">
      <section aria-labelledby="board-layout-columns">
        <h3 id="board-layout-columns" className="board-layout__heading">
          {t('projects:boardColumns.title')}
        </h3>
        <p className="board-layout__hint">{t('projects:boardColumns.description')}</p>
        <ProjectColumnsManager
          projectId={ws.projectId}
          agentsLocked={agentColumnsLocked(
            features.agents,
            project ? projectFolder(project) !== null : false
          )}
          onError={setError}
          onSaved={() => setError(null)}
        />
      </section>
      <section aria-labelledby="board-layout-wip">
        <h3 id="board-layout-wip" className="board-layout__heading">
          {t('tasks:boardLayout.wipLimits')}
        </h3>
        <p className="board-layout__hint">{t('tasks:boardLayout.wipLimitsHint')}</p>
        <div className="board-layout__wip">
          {/* A limit is a status's: the project's own columns (MOP-26) have none. */}
          {ws.columns
            .filter((column) => column.columnId === null)
            .map((column) => (
              <WipLimitField key={column.status} ws={ws} status={column.status} />
            ))}
        </div>
      </section>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </div>
  )
}

function WipLimitField({ ws, status }: { ws: PlanningWorkspace; status: PlanningWorkItemStatus }) {
  const saved = ws.wipLimits[status] ?? null
  const [draft, setDraft] = useState<number | null>(saved)
  const save = () => {
    if (draft === saved) return
    if (draft !== null && (!Number.isInteger(draft) || draft < 1)) return setDraft(saved)
    void ws.setColumnWipLimit(status, draft)
  }
  return (
    <NumberField
      label={ws.statusWords.label(status)}
      min={1}
      placeholder={t('tasks:boardView.noLimit')}
      value={draft}
      onChange={setDraft}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') save()
      }}
    />
  )
}
