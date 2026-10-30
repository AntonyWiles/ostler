import { useEffect, useRef, useState } from 'react'
import type { GitProjectState, PlanningSubproject, RendererProject } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import type { MenuEntry } from '../../ui'
import { Button, Chip, IconButton, Menu, Tooltip } from '../../ui'
import { ChevronDown, Folder, GitBranch, Icon, Pencil, Plus, X } from '../../ui/icons'
import { renameProject } from '../../components/ProjectActions'
import { projectNameHint } from '../../components/project-name-hint'
import { useOstler } from '../../context/OstlerContext'
import { shortcut } from '../../navigation/shortcuts'
import { t } from '@shared/i18n'
import { useMyShareRole } from '../../hooks/useMyShareRole'
import { capabilitiesOf } from '@shared/share-roles'
import { ProjectMark } from '../../components/ProjectMark'
import { SubprojectDialog, type SubprojectDialogMode } from '../../components/SubprojectDialog'
import { liveSubprojects } from '../planning/subproject-ui'

interface ProjectHeaderProps {
  project: RendererProject
  onNewTask: () => void
  /** The More menu: registry entries with placement 'more', then project actions. */
  moreItems: readonly MenuEntry[]
  onRenamed: () => void
  /** The project's workstreams and the one open now, for the switcher after the name. */
  workstreams?: WorkstreamsProps
}

interface WorkstreamsProps {
  /** All of the project's workstreams, archived ones included. */
  list: readonly PlanningSubproject[]
  /** The workstream open now (the address's `sub`), or null for the whole project. */
  currentId: string | null
  /** False on a view that always shows the whole project, such as the Library. */
  viewScoped: boolean
  /** Opens a workstream, or the whole project for null, on the same view. */
  onChoose: (subprojectId: string | null) => void
}

/**
 * The workspace header: the project's colour and name (rename inline), its
 * folder chip when one is linked, "New task" and the More menu.
 */
export function ProjectHeader({
  project,
  onNewTask,
  moreItems,
  onRenamed,
  workstreams
}: ProjectHeaderProps) {
  const folder = projectFolder(project)
  const role = useMyShareRole(project.id)
  const gitState = useGitState(project.id, folder !== null)

  return (
    <header className="ostler-workspace-header" data-tour="project-header">
      <ProjectMark
        project={{ color: project.color || 'var(--color-accent)', icon: project.icon }}
        className="ostler-workspace-dot"
      />
      <InlineName project={project} onRenamed={onRenamed} />
      {workstreams && <WorkstreamSwitcher project={project} {...workstreams} />}
      {folder !== null && (
        <Tooltip content={folder}>
          <span className="ostler-workspace-folder" tabIndex={0}>
            <Chip>
              <Icon icon={Folder} />
              <span className="ostler-workspace-folder-path">{folderName(folder)}</span>
              {gitState?.isGitRepo && (
                <>
                  <Icon icon={GitBranch} label={t('navigation:projectHeader.branch')} />
                  {gitState.currentBranch ?? 'detached'}
                </>
              )}
            </Chip>
          </span>
        </Tooltip>
      )}
      <span className="ostler-workspace-header-spacer" />
      <Tooltip
        content={t('navigation:projectHeader.quickAddPress')}
        shortcut={shortcut('new-task').keys}
      >
        <Button
          variant="primary"
          icon={Plus}
          disabled={!capabilitiesOf(role).createTasks}
          onClick={onNewTask}
          data-tour="new-task"
        >
          {t('navigation:projectHeader.newTask')}
        </Button>
      </Tooltip>
      <Menu
        label={t('navigation:projectHeader.moreProjectActions')}
        items={moreItems}
        placement="bottom-end"
      />
    </header>
  )
}

/**
 * "Project › Workstream ▾" after the name: which workstream is open, a menu to open another or the
 * whole project, and × to go back to the whole project. Absent while the project has no live
 * workstream and none is open, so a project without them looks as it always did.
 */
function WorkstreamSwitcher({
  project,
  list,
  currentId,
  viewScoped,
  onChoose
}: { project: RendererProject } & WorkstreamsProps) {
  const [dialog, setDialog] = useState<{
    mode: SubprojectDialogMode
    subproject: PlanningSubproject | null
  } | null>(null)
  const live = liveSubprojects(list)
  const current = currentId ? (list.find((sub) => sub.id === currentId) ?? null) : null
  if (live.length === 0 && !current) return null

  const items: MenuEntry[] = [
    {
      label: t('projects:subprojects.scopeBack', { projectName: project.name }),
      checked: current === null,
      checkKind: 'radio',
      onSelect: () => onChoose(null)
    },
    ...live.map((sub) => ({
      label: sub.name,
      checked: sub.id === current?.id,
      checkKind: 'radio' as const,
      onSelect: () => onChoose(sub.id)
    })),
    { type: 'separator' as const },
    ...(current
      ? [
          {
            label: t('projects:subprojects.editNamed', { name: current.name }),
            icon: Pencil,
            onSelect: () => setDialog({ mode: 'details', subproject: current })
          }
        ]
      : []),
    {
      label: t('projects:subprojects.newWorkstream'),
      icon: Plus,
      onSelect: () => setDialog({ mode: 'new', subproject: null })
    }
  ]

  return (
    <span className="ostler-workspace-scope">
      <span aria-hidden="true">›</span>
      <Menu
        label={t('projects:subprojects.chooseWorkstream')}
        items={items}
        renderTrigger={(props) => (
          <button
            {...props}
            type="button"
            className={`ostler-workspace-scope-trigger${current ? ' is-scoped' : ''}`}
          >
            {current && <ProjectMark project={current} className="project-color" />}
            <span className="ostler-workspace-scope-name">
              {current ? current.name : t('projects:subprojects.allWorkstreams')}
            </span>
            <Icon icon={ChevronDown} />
          </button>
        )}
      />
      {current && (
        <IconButton
          icon={X}
          size="sm"
          label={t('projects:subprojects.scopeBack', { projectName: project.name })}
          onClick={() => onChoose(null)}
        />
      )}
      {current && !viewScoped && (
        <span className="ostler-workspace-scope-note">
          {t('projects:subprojects.viewShowsWholeProject')}
        </span>
      )}
      {dialog && (
        <SubprojectDialog
          project={project}
          subproject={dialog.subproject}
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onSaved={(saved, created) => {
            setDialog(null)
            if (created) onChoose(saved.id)
          }}
        />
      )}
    </span>
  )
}

/** The last part of a folder path, for the chip; the tooltip has the whole path. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** The name as a heading that becomes a text field to rename it. */
function InlineName({ project, onRenamed }: { project: RendererProject; onRenamed: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.name)
  const [error, setError] = useState<string | null>(null)
  const { projects } = useOstler()
  const warning = editing ? projectNameHint(draft, projects, { exceptId: project.id }) : undefined
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!editing) setDraft(project.name)
  }, [project.name, editing])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = async () => {
    const problem = await renameProject(project, draft)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setEditing(false)
    onRenamed()
  }

  if (editing) {
    return (
      <span className="ostler-workspace-name-edit">
        <input
          ref={inputRef}
          className="ostler-workspace-name-input"
          aria-label={t('navigation:projectHeader.projectName')}
          aria-invalid={error ? true : undefined}
          aria-describedby={!error && warning ? `${project.id}-name-warning` : undefined}
          value={draft}
          maxLength={80}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setDraft(project.name)
              setError(null)
              setEditing(false)
            }
          }}
        />
        {error ? (
          <span className="ostler-workspace-name-error" role="alert">
            {error}
          </span>
        ) : (
          warning && (
            <span id={`${project.id}-name-warning`} className="ostler-workspace-name-warning">
              {warning}
            </span>
          )
        )}
      </span>
    )
  }

  return (
    <h1 className="ostler-workspace-name">
      <Tooltip content={t('navigation:projectHeader.rename')}>
        <button
          type="button"
          className="ostler-workspace-name-button"
          onClick={() => setEditing(true)}
        >
          {project.name}
        </button>
      </Tooltip>
    </h1>
  )
}

/** The folder's Git state for the chip, kept current by 'git' pushes. */
function useGitState(projectId: string, hasFolder: boolean): GitProjectState | null {
  const [state, setState] = useState<GitProjectState | null>(null)
  useEffect(() => {
    setState(null)
    if (!hasFolder) return
    let active = true
    const load = async () => {
      const result = await window.ostlerAPI.getGitState(projectId)
      if (active && result.ok) setState(result.value)
    }
    void load()
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.projectId === projectId && update.field === 'git') void load()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [projectId, hasFolder])
  return state
}
