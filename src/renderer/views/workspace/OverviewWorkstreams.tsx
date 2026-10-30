import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { PlanningMilestone, PlanningSubproject, RendererProject } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { NO_RECORD, type TaskFilter } from '@shared/task-filter'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { projectPath, subprojectPath } from '../../navigation/paths'
import { usePeople } from '../../context/PeopleContext'
import { ProjectMark } from '../../components/ProjectMark'
import { SubprojectDialog } from '../../components/SubprojectDialog'
import { Button, Card, ProgressBar, Section, useConfirm, useToast } from '../../ui'
import { liveSubprojects } from '../planning/subproject-ui'
import { MilestoneDue } from '../planning/MilestoneDue'

interface Counts {
  open: number
  done: number
}

/**
 * Done and open tasks, counted as the Milestones glance counts them (a task is done when its
 * projected status is done), so a workstream's bar never disagrees with its milestones.
 */
function countTasks(ws: PlanningWorkspace, subprojectId: string | null): Counts {
  let done = 0
  let open = 0
  for (const item of ws.workItems) {
    if ((item.subprojectId ?? null) !== subprojectId) continue
    if (ws.projectedStatus(item) === 'done') done++
    else open++
  }
  return { open, done }
}

/**
 * The project's work that belongs to no workstream: the List, done tasks included, filtered by
 * Workstream is "No workstream" through the same address filter a live list's "and more" uses.
 */
export function looseWorkPath(projectId: string): string {
  const filter: TaskFilter = {
    match: 'all',
    conditions: [{ field: 'subproject', op: 'is', value: [NO_RECORD] }]
  }
  return projectPath(projectId, 'list', { filter: JSON.stringify(filter) })
}

/** The earliest open milestone of a workstream: by due date, dated ones first. */
function nextMilestone(
  milestones: readonly PlanningMilestone[],
  subprojectId: string
): PlanningMilestone | null {
  const open = milestones
    .filter(
      (milestone) =>
        milestone.subprojectId === subprojectId &&
        (milestone.status === 'active' || milestone.status === 'planned')
    )
    .sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))
  return open[0] ?? null
}

function statusLabel(status: PlanningSubproject['status']): string {
  if (status === 'done') return t('projects:subprojects.statusDone')
  if (status === 'on_hold') return t('projects:subprojects.statusOnHold')
  return t('projects:subprojects.statusActive')
}

/**
 * The Overview's Workstreams section: a row per live workstream with its status, lead, counts,
 * progress and next milestone, then the archived ones folded away with Restore and Delete.
 * Absent while the project has no workstream at all, archived included.
 */
export function OverviewWorkstreams({
  project,
  ws
}: {
  project: RendererProject
  ws: PlanningWorkspace
}) {
  const people = usePeople()
  const confirm = useConfirm()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const all = ws.subprojects
  if (all.length === 0) return null
  const live = liveSubprojects(all)
  const archived = all.filter((sub) => sub.archivedAt !== null)
  const loose = countTasks(ws, null)

  const fail = (title: string, error: string) => toast({ title, body: error, tone: 'danger' })
  const restore = async (sub: PlanningSubproject) => {
    const result = await window.ostlerAPI.archiveSubproject(sub.id, false)
    if (!result.ok) fail(t('projects:subprojects.couldntRestore'), result.error)
  }
  const remove = async (sub: PlanningSubproject) => {
    const result = await window.ostlerAPI.deleteSubproject(sub.id)
    if (!result.ok) fail(t('projects:subprojects.couldntDelete'), result.error)
  }

  return (
    <Section
      title={t('projects:subprojects.workstreams')}
      actions={
        <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
          {t('projects:subprojects.newWorkstream')}
        </Button>
      }
    >
      <ul className="overview-workstreams" aria-label={t('projects:subprojects.workstreams')}>
        {live.map((sub) => {
          const counts = countTasks(ws, sub.id)
          const total = counts.open + counts.done
          const next = nextMilestone(ws.milestones, sub.id)
          const lead = sub.leadId ? people.byId.get(sub.leadId) : undefined
          return (
            <li key={sub.id}>
              <Card className="overview-workstream">
                <div className="overview-workstream__head">
                  <ProjectMark project={sub} className="project-color" />
                  <Link
                    className="overview-workstream__name"
                    to={subprojectPath(project.id, sub.id)}
                    title={sub.name}
                  >
                    {sub.name}
                  </Link>
                  <span className="overview-workstream__status">{statusLabel(sub.status)}</span>
                </div>
                <ProgressBar
                  label={t('projects:subprojects.progressLabel', { name: sub.name })}
                  value={counts.done}
                  max={Math.max(total, 1)}
                  valueText={t('projects:subprojects.progressText', {
                    done: counts.done,
                    total
                  })}
                  tone="accent"
                />
                <div className="overview-workstream__meta">
                  <span>{t('projects:subprojects.openCount', { count: counts.open })}</span>
                  <span>{t('projects:subprojects.doneCount', { count: counts.done })}</span>
                  {lead && <span>{t('projects:subprojects.leadName', { name: lead.name })}</span>}
                  {next && (
                    <span>
                      {t('projects:subprojects.nextMilestone', { name: next.name })}{' '}
                      <MilestoneDue milestone={next} />
                    </span>
                  )}
                </div>
              </Card>
            </li>
          )
        })}
        {loose.open + loose.done > 0 && (
          <li>
            <Card className="overview-workstream">
              <div className="overview-workstream__head">
                <Link
                  className="overview-workstream__name"
                  to={looseWorkPath(project.id)}
                  title={t('projects:subprojects.notInWorkstream')}
                >
                  {t('projects:subprojects.notInWorkstream')}
                </Link>
              </div>
              <div className="overview-workstream__meta">
                <span>{t('projects:subprojects.openCount', { count: loose.open })}</span>
                <span>{t('projects:subprojects.doneCount', { count: loose.done })}</span>
              </div>
            </Card>
          </li>
        )}
      </ul>

      {archived.length > 0 && (
        <div className="overview-workstreams__archived">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={archivedOpen}
            onClick={() => setArchivedOpen((open) => !open)}
          >
            {t('projects:subprojects.archivedCount', { count: archived.length })}
          </Button>
          {archivedOpen && (
            <ul className="overview-workstreams">
              {archived.map((sub) => (
                <li key={sub.id} className="overview-workstream overview-workstream--archived">
                  <ProjectMark project={sub} className="project-color" />
                  <span className="overview-workstream__name">{sub.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('projects:subprojects.restoreNamed', { name: sub.name })}
                    onClick={() => void restore(sub)}
                  >
                    {t('projects:subprojects.restore')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('projects:subprojects.deleteNamed', { name: sub.name })}
                    onClick={() =>
                      void confirm({
                        title: t('projects:subprojects.deleteTitle', { name: sub.name }),
                        body: t('projects:subprojects.deleteBody'),
                        confirmLabel: t('projects:subprojects.deleteConfirm'),
                        tone: 'danger'
                      })
                        .then((yes) => (yes ? remove(sub) : undefined))
                        .catch(() => undefined)
                    }
                  >
                    {t('projects:subprojects.delete')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {creating && (
        <SubprojectDialog
          project={project}
          subproject={null}
          mode="new"
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            void ws.reloadSubprojects()
            navigate(subprojectPath(project.id, saved.id))
          }}
        />
      )}
    </Section>
  )
}

/** The quiet way to make the first workstream, shown while the project has none. */
export function NewWorkstreamButton({
  project,
  ws
}: {
  project: RendererProject
  ws: PlanningWorkspace
}) {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  if (ws.subprojects.length > 0) return null
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
        {t('projects:subprojects.newWorkstream')}
      </Button>
      {creating && (
        <SubprojectDialog
          project={project}
          subproject={null}
          mode="new"
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            void ws.reloadSubprojects()
            navigate(subprojectPath(project.id, saved.id))
          }}
        />
      )}
    </>
  )
}

/**
 * The header of an Overview scoped to one workstream: its name, status, lead and members, its
 * description, and Edit. The sections below then count only its work.
 */
export function WorkstreamHeader({
  project,
  ws,
  subproject
}: {
  project: RendererProject
  ws: PlanningWorkspace
  subproject: PlanningSubproject
}) {
  const people = usePeople()
  const [editing, setEditing] = useState(false)
  const lead = subproject.leadId ? people.byId.get(subproject.leadId) : undefined
  const members = subproject.memberIds
    .map((id) => people.byId.get(id)?.name)
    .filter((name): name is string => Boolean(name))
  return (
    <Card className="overview-workstream-header">
      <div className="overview-workstream__head">
        <ProjectMark project={subproject} className="project-color" />
        <h2 className="overview-workstream__name">{subproject.name}</h2>
        <span className="overview-workstream__status">{statusLabel(subproject.status)}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('projects:subprojects.editNamed', { name: subproject.name })}
          onClick={() => setEditing(true)}
        >
          {t('projects:subprojects.edit')}
        </Button>
      </div>
      {subproject.description && <p className="overview-quiet">{subproject.description}</p>}
      <div className="overview-workstream__meta">
        {lead && <span>{t('projects:subprojects.leadName', { name: lead.name })}</span>}
        {members.length > 0 && (
          <span>{t('projects:subprojects.membersNames', { names: members.join(', ') })}</span>
        )}
      </div>
      {editing && (
        <SubprojectDialog
          project={project}
          subproject={subproject}
          mode="details"
          onClose={() => setEditing(false)}
          onSaved={() => void ws.reloadSubprojects()}
        />
      )}
    </Card>
  )
}
