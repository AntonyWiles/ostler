import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type {
  GoalCheckInInput,
  GoalMeasure,
  LinkableProjectGoal,
  PersonalGoalCheckIn,
  PersonalGoalLink,
  PersonalGoalStatus,
  PersonalGoalView
} from '@shared/ostler-api'
import {
  formatMeasureValue,
  measureAgainstTarget,
  measureSummary,
  paceText,
  sortCheckIns,
  type GoalPace
} from '@shared/goal-measures'
import { formatIsoDateShort } from '@shared/dates'
import { t } from '@shared/i18n'
import { useProjectList } from '../../context/OstlerContext'
import { ProjectMark } from '../../components/ProjectMark'
import { pinEntries, usePins } from '../../pins/PinsProvider'
import {
  Collapse,
  Badge,
  Button,
  EmptyState,
  IconButton,
  InlineAlert,
  Menu,
  PageHeader,
  Select,
  toIsoDate,
  useToast,
  type BadgeTone,
  type MenuEntry
} from '../../ui'
import {
  chevronClass,
  ChevronRight,
  Ellipsis,
  Link2,
  Pencil,
  Plus,
  Target,
  Trash2,
  X
} from '../../ui/icons'
import { GoalMeasureChart } from '../planning/goal-measure/GoalMeasureChart'
import { GoalCheckInDialog, GoalMeasureDialog } from '../planning/goal-measure/GoalMeasureDialogs'
import { AddProjectGoalDialog, PersonalGoalDialog } from './GoalDialogs'
import { usePersonalGoals } from './usePersonalGoals'
import '../planning/goal-measure/GoalMeasure.css'
import './GoalsView.css'

const PACE_TONE: Record<GoalPace, BadgeTone> = {
  reached: 'success',
  ahead: 'success',
  'on-pace': 'info',
  behind: 'warning'
}

function statusLabel(status: PersonalGoalStatus): string {
  switch (status) {
    case 'active':
      return t('views:goals.statusActive')
    case 'achieved':
      return t('views:goals.statusAchieved')
    case 'dropped':
      return t('views:goals.statusDropped')
  }
}

const STATUSES: PersonalGoalStatus[] = ['active', 'achieved', 'dropped']

type Dialog =
  | { kind: 'new' }
  | { kind: 'edit'; goal: PersonalGoalView }
  | { kind: 'measure'; goal: PersonalGoalView }
  | { kind: 'check-in'; goal: PersonalGoalView; checkIn: PersonalGoalCheckIn | null }
  | { kind: 'link'; goal: PersonalGoalView; candidates: LinkableProjectGoal[] }
  | null

/**
 * Goals (N5.6b, N41): goals of one's own, outside any project, active first
 * and the achieved and dropped folded below. Each has N5.6a's measure,
 * chart and pace, its check-ins, and the project goals that count towards
 * it with their projects' colours and icons. `?goal=<id>` shows one (a pin,
 * a countdown and a project goal's card link here).
 */
export function GoalsView() {
  const { goals, reload } = usePersonalGoals()
  const { toastUndo, toast } = useToast()
  const [params] = useSearchParams()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<'achieved' | 'dropped', boolean>>({
    achieved: false,
    dropped: false
  })
  const today = toIsoDate(new Date())
  const shownId = params.get('goal')

  // A link to a folded goal unfolds its group.
  useEffect(() => {
    const status = goals?.find((goal) => goal.id === shownId)?.status
    if (status === 'achieved' || status === 'dropped')
      setOpen((current) => (current[status] ? current : { ...current, [status]: true }))
  }, [goals, shownId])

  const update = async (
    goal: PersonalGoalView,
    patch: Parameters<typeof window.ostlerAPI.updatePersonalGoal>[1]
  ): Promise<string | null> => {
    const result = await window.ostlerAPI.updatePersonalGoal(goal.id, patch)
    if (!result.ok) return result.error || t('views:goals.couldntSave')
    await reload()
    return null
  }

  const run = async (action: Promise<string | null>) => {
    const failure = await action
    setError(failure)
    return failure
  }

  const remove = async (goal: PersonalGoalView) => {
    const result = await window.ostlerAPI.deletePersonalGoal(goal.id)
    if (!result.ok) {
      setError(result.error || t('views:goals.couldntDelete'))
      return
    }
    await reload()
    toastUndo(t('views:goals.deleted', { title: goal.title }), async () => {
      await window.ostlerAPI.restorePersonalGoal(result.value)
      await reload()
    })
  }

  const changeStatus = async (goal: PersonalGoalView, status: PersonalGoalStatus) => {
    const before = goal.status
    if ((await run(update(goal, { status }))) !== null) return
    toastUndo(
      t('views:goals.statusChanged', { title: goal.title, status: statusLabel(status) }),
      () => void run(update(goal, { status: before }))
    )
  }

  const removeMeasure = async (goal: PersonalGoalView) => {
    const before = goal.measure
    if ((await run(update(goal, { measure: null }))) !== null) return
    toastUndo(
      t('views:goals.measureRemoved', { title: goal.title }),
      () => void run(update(goal, { measure: before })),
      t('views:goals.measureRemovedBody')
    )
  }

  const checkIn = async (goal: PersonalGoalView, input: GoalCheckInInput): Promise<boolean> => {
    const result = await window.ostlerAPI.recordPersonalGoalCheckIn(goal.id, input)
    if (!result.ok) {
      setError(result.error || t('tasks:goalMeasure.couldntCheckIn'))
      return false
    }
    setError(null)
    await reload()
    const { replaced } = result.value
    toastUndo(
      replaced
        ? t('tasks:goalMeasure.replaced', { date: formatIsoDateShort(input.date) })
        : t('tasks:goalMeasure.checkedIn', {
            value: formatMeasureValue(input.value, goal.measure?.unit ?? '')
          }),
      async () => {
        if (replaced) await window.ostlerAPI.restorePersonalGoalCheckIn(goal.id, replaced)
        else await window.ostlerAPI.deletePersonalGoalCheckIn(goal.id, input.date)
        await reload()
      }
    )
    return true
  }

  const removeCheckIn = async (goal: PersonalGoalView, entry: PersonalGoalCheckIn) => {
    const result = await window.ostlerAPI.deletePersonalGoalCheckIn(goal.id, entry.date)
    if (!result.ok) {
      setError(result.error || t('tasks:goalMeasure.couldntRemoveCheckIn'))
      return
    }
    await reload()
    toastUndo(
      t('tasks:goalMeasure.removed', { date: formatIsoDateShort(entry.date) }),
      async () => {
        await window.ostlerAPI.restorePersonalGoalCheckIn(goal.id, result.value)
        await reload()
      }
    )
  }

  /** Sets a project goal's link, with Undo putting the one before back. */
  const setLink = async (
    goalId: string,
    personalGoalId: string | null,
    words: string
  ): Promise<boolean> => {
    const result = await window.ostlerAPI.setGoalCountsTowards(goalId, personalGoalId)
    if (!result.ok) {
      toast({ title: t('views:goals.couldntLink'), body: result.error, tone: 'danger' })
      return false
    }
    await reload()
    const { previous } = result.value
    toastUndo(words, async () => {
      await window.ostlerAPI.setGoalCountsTowards(goalId, previous)
      await reload()
    })
    return true
  }

  const addProjectGoal = async (goal: PersonalGoalView) => {
    const result = await window.ostlerAPI.listLinkableProjectGoals()
    setDialog({ kind: 'link', goal, candidates: result.ok ? result.value : [] })
  }

  const saveMeasure = (goal: PersonalGoalView) => async (measure: GoalMeasure) =>
    (await run(update(goal, { measure }))) === null

  const active = (goals ?? []).filter((goal) => goal.status === 'active')
  const folded = (status: 'achieved' | 'dropped') =>
    (goals ?? []).filter((goal) => goal.status === status)

  const card = (goal: PersonalGoalView) => (
    <PersonalGoalCard
      key={goal.id}
      goal={goal}
      highlighted={goal.id === shownId}
      onStatus={(status) => void changeStatus(goal, status)}
      onEdit={() => setDialog({ kind: 'edit', goal })}
      onMeasure={() => setDialog({ kind: 'measure', goal })}
      onRemoveMeasure={() => void removeMeasure(goal)}
      onCheckIn={(entry) => setDialog({ kind: 'check-in', goal, checkIn: entry })}
      onRemoveCheckIn={(entry) => void removeCheckIn(goal, entry)}
      onAddProjectGoal={() => void addProjectGoal(goal)}
      onRemoveLink={(link) =>
        void setLink(
          link.goalId,
          null,
          t('views:goals.linkRemoved', { title: link.title, goal: goal.title })
        )
      }
      onDelete={() => void remove(goal)}
    />
  )

  return (
    <div className="goals-view">
      <PageHeader
        title={t('views:goals.title')}
        subtitle={t('views:goals.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: 'new' })}>
            {t('views:goals.new')}
          </Button>
        }
      />
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      {goals !== null && goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title={t('views:goals.emptyTitle')}
          description={t('views:goals.emptyBody')}
          action={
            <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: 'new' })}>
              {t('views:goals.new')}
            </Button>
          }
        />
      ) : (
        <section className="goals-view__list" aria-label={t('views:goals.list')}>
          {active.map(card)}
          {(['achieved', 'dropped'] as const).map((status) => {
            const entries = folded(status)
            if (entries.length === 0) return null
            const id = `goals-view-${status}`
            return (
              <div key={status} className="goals-view__folded">
                <Button
                  variant="ghost"
                  icon={ChevronRight}
                  iconClassName={chevronClass(open[status])}
                  aria-expanded={open[status]}
                  aria-controls={id}
                  onClick={() => setOpen((current) => ({ ...current, [status]: !current[status] }))}
                >
                  {t(status === 'achieved' ? 'views:goals.achieved' : 'views:goals.dropped', {
                    count: entries.length
                  })}
                </Button>
                <Collapse open={open[status]} id={id} className="goals-view__folded-list">
                  {entries.map(card)}
                </Collapse>
              </div>
            )
          })}
        </section>
      )}
      {dialog?.kind === 'new' && (
        <PersonalGoalDialog
          goal={null}
          onClose={() => setDialog(null)}
          onSave={async (title, outcome) => {
            const result = await window.ostlerAPI.createPersonalGoal({ title, outcome })
            if (!result.ok) return result.error || t('views:goals.couldntSave')
            await reload()
            return null
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <PersonalGoalDialog
          goal={dialog.goal}
          onClose={() => setDialog(null)}
          onSave={(title, outcome) => update(dialog.goal, { title, outcome })}
        />
      )}
      {dialog?.kind === 'measure' && (
        <GoalMeasureDialog
          goalTitle={dialog.goal.title}
          measure={dialog.goal.measure}
          today={today}
          onClose={() => setDialog(null)}
          onSave={saveMeasure(dialog.goal)}
        />
      )}
      {dialog?.kind === 'check-in' && (
        <GoalCheckInDialog
          goalTitle={dialog.goal.title}
          unit={dialog.goal.measure?.unit ?? ''}
          checkIn={dialog.checkIn}
          today={today}
          onClose={() => setDialog(null)}
          onSave={(input) => checkIn(dialog.goal, input)}
        />
      )}
      {dialog?.kind === 'link' && (
        <AddProjectGoalDialog
          goal={dialog.goal}
          goals={goals ?? []}
          candidates={dialog.candidates}
          onClose={() => setDialog(null)}
          onAdd={(candidate) =>
            setLink(
              candidate.goalId,
              dialog.goal.id,
              t('views:goals.linkAdded', { title: candidate.title, goal: dialog.goal.title })
            )
          }
        />
      )}
    </div>
  )
}

function PersonalGoalCard({
  goal,
  highlighted,
  onStatus,
  onEdit,
  onMeasure,
  onRemoveMeasure,
  onCheckIn,
  onRemoveCheckIn,
  onAddProjectGoal,
  onRemoveLink,
  onDelete
}: {
  goal: PersonalGoalView
  highlighted: boolean
  onStatus: (status: PersonalGoalStatus) => void
  onEdit: () => void
  onMeasure: () => void
  onRemoveMeasure: () => void
  onCheckIn: (checkIn: PersonalGoalCheckIn | null) => void
  onRemoveCheckIn: (checkIn: PersonalGoalCheckIn) => void
  onAddProjectGoal: () => void
  onRemoveLink: (link: PersonalGoalLink) => void
  onDelete: () => void
}) {
  const pins = usePins()
  const projects = useProjectList()
  const ref = useRef<HTMLElement>(null)
  const byId = new Map(projects.map((project) => [project.id, project]))
  const measure = goal.measure
  const progress = goal.progress
  const headingId = `personal-goal-${goal.id}`

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [highlighted])

  const menu: MenuEntry[] = [
    { label: t('views:goals.edit'), icon: Pencil, onSelect: onEdit },
    {
      label: measure ? t('views:goals.editMeasure') : t('views:goals.addMeasure'),
      icon: Target,
      onSelect: onMeasure
    },
    ...(measure
      ? [{ label: t('views:goals.removeMeasure'), icon: X, onSelect: onRemoveMeasure }]
      : []),
    { label: t('views:goals.addProjectGoal'), icon: Link2, onSelect: onAddProjectGoal },
    ...pinEntries(pins, {
      kind: 'personal-goal',
      targetId: goal.id,
      projectId: '',
      title: goal.title
    }),
    { type: 'separator' },
    { label: t('views:goals.delete'), icon: Trash2, tone: 'danger', onSelect: onDelete }
  ]

  return (
    <article
      ref={ref}
      className={`goals-view__goal${highlighted ? ' is-highlighted' : ''}`}
      aria-labelledby={headingId}
      data-status={goal.status}
    >
      <header className="goals-view__goal-head">
        <div className="goals-view__goal-titles">
          <h2 id={headingId} className="goals-view__goal-title">
            {goal.title}
          </h2>
          {goal.outcome && <p className="goals-view__goal-outcome">{goal.outcome}</p>}
        </div>
        <div className="goals-view__goal-actions">
          <Select
            label={t('views:goals.status', { title: goal.title })}
            hideLabel
            size="sm"
            value={goal.status}
            options={STATUSES.map((status) => ({ value: status, label: statusLabel(status) }))}
            onChange={(event) => onStatus(event.target.value as PersonalGoalStatus)}
          />
          <Menu
            label={t('views:goals.actions', { title: goal.title })}
            placement="bottom-end"
            items={menu}
            renderTrigger={(trigger) => (
              <IconButton
                {...trigger}
                label={t('views:goals.actions', { title: goal.title })}
                icon={Ellipsis}
                size="sm"
              />
            )}
          />
        </div>
      </header>

      {!measure ? (
        <div className="goal-measure goal-measure--empty">
          <Button size="sm" variant="ghost" icon={Plus} onClick={onMeasure}>
            {t('views:goals.addMeasure')}
          </Button>
        </div>
      ) : (
        progress && (
          <div className="goal-measure" data-pace={progress.pace}>
            <div className="goal-measure__head">
              <strong className="goal-measure__value">
                {measureAgainstTarget(progress.latest, measure)}
              </strong>
              <Badge tone={PACE_TONE[progress.pace]}>{paceText(progress)}</Badge>
              {progress.pace === 'reached' && goal.status === 'active' && (
                <span className="goal-measure__hint">{t('tasks:goalMeasure.reachedHint')}</span>
              )}
              {!goal.fromLinks && (
                <span className="goal-measure__actions">
                  <Button size="sm" icon={Plus} onClick={() => onCheckIn(null)}>
                    {t('tasks:goalMeasure.checkIn')}
                  </Button>
                </span>
              )}
            </div>
            <GoalMeasureChart
              title={goal.title}
              measure={measure}
              checkIns={goal.readings}
              summary={measureSummary(progress, measure)}
            />
            {goal.fromLinks && (
              <p className="goal-measure__quiet">
                {t('views:goals.fromLinks', {
                  count: goal.links.filter((link) => link.mismatch === null).length
                })}
                {goal.checkIns.length > 0 && ` ${t('views:goals.checkInsIgnored')}`}
              </p>
            )}
            {!goal.fromLinks && (
              <section
                className="goal-measure__check-ins"
                aria-label={t('tasks:goalMeasure.checkIns')}
              >
                {goal.checkIns.length === 0 ? (
                  <p className="goal-measure__quiet">{t('tasks:goalMeasure.noCheckIns')}</p>
                ) : (
                  <ul>
                    {sortCheckIns(goal.checkIns)
                      .reverse()
                      .map((entry) => {
                        const date = formatIsoDateShort(entry.date)
                        return (
                          <li key={entry.date} className="goal-measure__check-in">
                            <span className="goal-measure__check-in-date">{date}</span>
                            <span className="goal-measure__check-in-value">
                              {formatMeasureValue(entry.value, measure.unit)}
                            </span>
                            {entry.note && (
                              <span className="goal-measure__check-in-note">{entry.note}</span>
                            )}
                            <IconButton
                              size="sm"
                              icon={Pencil}
                              label={t('tasks:goalMeasure.editCheckIn', { date })}
                              onClick={() => onCheckIn(entry)}
                            />
                            <IconButton
                              size="sm"
                              icon={Trash2}
                              label={t('tasks:goalMeasure.removeCheckIn', { date })}
                              onClick={() => onRemoveCheckIn(entry)}
                            />
                          </li>
                        )
                      })}
                  </ul>
                )}
              </section>
            )}
          </div>
        )
      )}

      <section className="goals-view__links" aria-label={t('views:goals.linksHeading')}>
        <h3 className="goals-view__links-heading">{t('views:goals.linksHeading')}</h3>
        {goal.links.length === 0 ? (
          <p className="goal-measure__quiet">{t('views:goals.noLinks')}</p>
        ) : (
          <ul>
            {goal.links.map((link) => {
              const project = byId.get(link.projectId)
              return (
                <li key={link.goalId} className="goals-view__link">
                  {project && <ProjectMark project={project} className="project-color" />}
                  <span className="goals-view__link-title">{link.title}</span>
                  <span className="goals-view__link-project">
                    {project?.name}
                    {project && !project.enabled && ` (${t('views:goals.projectOff')})`}
                  </span>
                  {link.mismatch ? (
                    <span className="goals-view__link-note">
                      {link.mismatch === 'unit'
                        ? t('views:goals.mismatchUnit')
                        : link.mismatch === 'direction'
                          ? t('views:goals.mismatchDirection')
                          : t('views:goals.mismatchNoMeasure')}
                    </span>
                  ) : (
                    link.latest !== null &&
                    link.measure && (
                      <span className="goals-view__link-value">
                        {t('views:goals.linkLatest', {
                          value: formatMeasureValue(link.latest, link.measure.unit)
                        })}
                      </span>
                    )
                  )}
                  <IconButton
                    size="sm"
                    icon={X}
                    label={t('views:goals.removeLink', { title: link.title, goal: goal.title })}
                    onClick={() => onRemoveLink(link)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </article>
  )
}
