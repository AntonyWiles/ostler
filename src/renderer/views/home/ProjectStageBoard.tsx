import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RendererProject } from '@shared/ostler-api'
import { groupProjectsByArea, type ProjectArea } from '@shared/project-areas'
import {
  normalizeProjectStage,
  PROJECT_STAGES,
  type ProjectStage,
  type ProjectStageNames
} from '@shared/project-stages'
import { formatIsoDateShort } from '@shared/dates'
import { t } from '@shared/i18n'
import {
  Button,
  Card,
  Dialog,
  Menu,
  ProgressBar,
  TextField,
  useAnnounce,
  useReorderMotion,
  useToast
} from '../../ui'
import { projectOpenPath } from '../../navigation/paths'
import { ProjectMark } from '../../components/ProjectMark'
import { defaultStageName, projectStageName } from '../../components/project-stage-name'
import { useOstler } from '../../context/OstlerContext'
import type { PortfolioProjectSummary, PortfolioSummary } from '../planning/portfolio-aggregation'
import './ProjectStageBoard.css'
import { StatusUpdateChip } from '../../components/status-updates/StatusUpdateChip'
import { useLatestStatusUpdates } from '../../components/status-updates/useStatusUpdates'

/** Done projects shown before "Show 12 more". */
export const DONE_VISIBLE = 5

/**
 * Changes a project's stage through the one project save, with undo in the
 * toast and the move announced (N5.3). The board's drag, its keys and its
 * card menu all come here, as does the Plan page's Start the project. The
 * function resolves to true when the stage was saved, and false otherwise
 * (no such project, already in that stage, or the save failed).
 */
export function useMoveProjectStage(names: ProjectStageNames) {
  const { projects, refreshProjects } = useOstler()
  const { toastUndo, toast } = useToast()
  const announce = useAnnounce()
  const save = async (projectId: string, stage: ProjectStage) => {
    const result = await window.ostlerAPI.updateProject(projectId, { stage })
    await refreshProjects()
    return result
  }
  return async (projectId: string, to: ProjectStage): Promise<boolean> => {
    const project = projects.find((entry) => entry.id === projectId)
    if (!project) return false
    const from = normalizeProjectStage(project.stage)
    if (from === to) return false
    const result = await save(projectId, to)
    if (!result.ok) {
      toast({
        tone: 'danger',
        title: t('projects:projectStages.couldntMove', {
          project: project.name,
          error: result.error
        })
      })
      return false
    }
    const message = t('projects:projectStages.moved', {
      project: project.name,
      name: projectStageName(to, names)
    })
    announce(message)
    toastUndo(message, () => save(projectId, from))
    return true
  }
}

/**
 * Home's board of projects (N5.3, N38): Planning, Active, On hold and Done,
 * each column under its display name and, with areas, grouped by area. It
 * reads the summary Home already loaded for its cards, never one call per
 * project. Drag a card, use its menu, or press Alt+Left or Alt+Right on it to
 * change the stage.
 */
export function ProjectStageBoard({
  projects,
  areas,
  summary,
  names,
  onRename
}: {
  projects: RendererProject[]
  areas: ProjectArea[]
  summary: PortfolioSummary
  names: ProjectStageNames
  onRename: (names: ProjectStageNames) => Promise<string | null>
}) {
  const navigate = useNavigate()
  const move = useMoveProjectStage(names)
  const latestUpdates = useLatestStatusUpdates()
  const [dragOver, setDragOver] = useState<ProjectStage | null>(null)
  const [showAllDone, setShowAllDone] = useState(false)
  const boardRef = useRef<HTMLDivElement | null>(null)
  useReorderMotion(boardRef)
  const [renaming, setRenaming] = useState<ProjectStage | null>(null)
  const byId = new Map(summary.projects.map((entry) => [entry.projectId, entry]))
  const grouped = areas.length > 0

  const stageOf = (project: RendererProject) => normalizeProjectStage(project.stage)

  const card = (project: RendererProject) => {
    const entry = byId.get(project.id)
    const stage = stageOf(project)
    const index = PROJECT_STAGES.indexOf(stage)
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
      if (!event.altKey || event.target !== event.currentTarget) return
      const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      const to = PROJECT_STAGES[index + step]
      if (step === 0 || !to) return
      event.preventDefault()
      void move(project.id, to)
    }
    return (
      <li key={project.id} data-motion-key={project.id}>
        <Card
          as="article"
          interactive
          draggable
          padding="sm"
          aria-label={project.name}
          aria-describedby="project-stage-board-hint"
          className="project-stage-card"
          onClick={() => navigate(projectOpenPath(project.id, project.stage))}
          onKeyDown={onKeyDown}
          onDragStart={(event: DragEvent<HTMLElement>) => {
            event.dataTransfer.setData('text/plain', project.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDragOver(null)}
        >
          <div className="project-stage-card__head">
            <ProjectMark project={project} className="project-stage-card__dot" />
            <span className="project-stage-card__name" title={project.name}>
              {project.name}
            </span>
            <span
              className="project-stage-card__menu"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Menu
                label={t('projects:projectStages.cardOptions', { project: project.name })}
                items={() => [
                  {
                    label: t('projects:projectStages.openProject'),
                    onSelect: () => navigate(projectOpenPath(project.id, project.stage))
                  },
                  { type: 'separator' as const },
                  ...PROJECT_STAGES.filter((other) => other !== stage).map((other) => ({
                    label: t('projects:projectStages.moveTo', {
                      name: projectStageName(other, names)
                    }),
                    onSelect: () => void move(project.id, other)
                  }))
                ]}
              />
            </span>
          </div>
          <StatusUpdateChip
            latest={latestUpdates[project.id] ?? null}
            reminder={project.updateReminder}
          />
          {entry && <CardDetails project={project} entry={entry} />}
        </Card>
      </li>
    )
  }

  const list = (members: RendererProject[], label: string) => (
    <ul className="project-stage-column__list" aria-label={label}>
      {members.map(card)}
    </ul>
  )

  return (
    <>
      <p id="project-stage-board-hint" className="project-stage-board__hint">
        {t('projects:projectStages.moveHint')}
      </p>
      <div
        ref={boardRef}
        className="project-stage-board"
        aria-label={t('projects:projectStages.boardLabel')}
      >
        {PROJECT_STAGES.map((stage) => {
          const name = projectStageName(stage, names)
          const members = projects.filter((project) => stageOf(project) === stage)
          const collapsed = stage === 'done' && !showAllDone && members.length > DONE_VISIBLE
          const visible = collapsed ? members.slice(0, DONE_VISIBLE) : members
          const groups = grouped
            ? groupProjectsByArea(visible, areas).filter((group) => group.projects.length > 0)
            : []
          return (
            <section
              key={stage}
              className={`project-stage-column${dragOver === stage ? ' is-drop-target' : ''}`}
              aria-label={t('projects:projectStages.column', { name })}
              data-stage={stage}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                if (dragOver !== stage) setDragOver(stage)
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                if (dragOver === stage) setDragOver(null)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setDragOver(null)
                const projectId = event.dataTransfer.getData('text/plain')
                if (projectId) void move(projectId, stage)
              }}
            >
              <header className="project-stage-column__header">
                <h3 className="project-stage-column__title">{name}</h3>
                <span className="project-stage-column__count">{members.length}</span>
                <Menu
                  label={t('projects:projectStages.columnOptions', { name })}
                  items={[
                    {
                      label: t('projects:projectStages.renameColumn'),
                      onSelect: () => setRenaming(stage)
                    }
                  ]}
                />
              </header>
              {members.length === 0 ? (
                <p className="project-stage-column__empty">{t('projects:projectStages.empty')}</p>
              ) : grouped ? (
                groups.map((group) => {
                  const areaName = group.area?.name ?? t('projects:areas.noArea')
                  return (
                    <div key={group.area?.id ?? ''} className="project-stage-column__area">
                      <h4 className="project-stage-column__area-title">{areaName}</h4>
                      {list(group.projects, `${name}: ${areaName}`)}
                    </div>
                  )
                })
              ) : (
                list(visible, name)
              )}
              {stage === 'done' && members.length > DONE_VISIBLE && (
                <Button size="sm" variant="ghost" onClick={() => setShowAllDone(!showAllDone)}>
                  {collapsed
                    ? t('projects:projectStages.showMore', {
                        count: members.length - DONE_VISIBLE
                      })
                    : t('projects:projectStages.showFewer')}
                </Button>
              )}
            </section>
          )
        })}
      </div>
      <RenameColumnDialog
        stage={renaming}
        names={names}
        onClose={() => setRenaming(null)}
        onSave={onRename}
      />
    </>
  )
}

function CardDetails({
  project,
  entry
}: {
  project: RendererProject
  entry: PortfolioProjectSummary
}) {
  return (
    <>
      <ProgressBar
        label={t('tasks:portfolioView.progress', { projectName: project.name })}
        value={entry.doneCount}
        max={Math.max(entry.taskCount, 1)}
        valueText={t('tasks:portfolioView.tasksDone', {
          count: entry.taskCount,
          doneCount: entry.doneCount
        })}
      />
      {(entry.nextMilestone || entry.blockedCount > 0) && (
        <p className="project-stage-card__facts">
          {[
            entry.nextMilestone &&
              t('projects:projectStages.nextMilestone', {
                name: entry.nextMilestone.name,
                date: formatIsoDateShort(entry.nextMilestone.targetDate)
              }),
            entry.blockedCount > 0 &&
              t('projects:projectStages.blockers', { count: entry.blockedCount })
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </>
  )
}

function RenameColumnDialog({
  stage,
  names,
  onClose,
  onSave
}: {
  stage: ProjectStage | null
  names: ProjectStageNames
  onClose: () => void
  onSave: (names: ProjectStageNames) => Promise<string | null>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (stage === null) return null
  const value = draft ?? names[stage]
  const close = () => {
    setDraft(null)
    setError(null)
    onClose()
  }
  const submit = async () => {
    const problem = await onSave({ ...names, [stage]: value.trim() })
    if (problem) setError(problem)
    else close()
  }
  return (
    <Dialog
      open
      onClose={close}
      title={t('projects:projectStages.renameTitle', { name: projectStageName(stage, names) })}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('projects:projectStages.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void submit()}>
            {t('projects:projectStages.save')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('projects:projectStages.columnName')}
        hint={t('projects:projectStages.columnNameHint', { name: defaultStageName(stage) })}
        error={error ?? undefined}
        value={value}
        placeholder={defaultStageName(stage)}
        maxLength={40}
        data-autofocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
      />
    </Dialog>
  )
}
