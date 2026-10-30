import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { todayIsoDate } from '@shared/dates'
import { captureAssigneeId, parseQuickAdd, type QuickAddToken } from '@shared/quick-add'
import { useOstler } from '../../context/OstlerContext'
import { usePeople } from '../../context/PeopleContext'
import { useFeatures } from '../../navigation/features'
import { TasksFromTextButton } from '../tasks-from-text/TasksFromTextDialog'
import { parseAppPath, projectPath, SUBPROJECT_PARAM, taskPath } from '../../navigation/paths'
import { Button, Checkbox, Chip, Select, TextField, useToast } from '../../ui'
import { useAddToMyDay } from '../../hooks/useMyDay'
import { Highlighter, Plus } from '../../ui/icons'
import { MarkupEditor } from '../markup/MarkupEditor'
import { TaskTemplateSelect } from '../../task-templates/TaskTemplateSelect'
import { droppedText, useTaskTemplates } from '../../task-templates/useTaskTemplates'
import './QuickAdd.css'
import { t } from '@shared/i18n'
import { projectSelectOptions } from '../areas/project-options'
import { TaskTypeField } from '../../task-types/TaskTypeField'
import type { PlanningTaskType } from '@shared/ostler-api'
import type { SnipPreview } from '@shared/snip'
import { shownCache } from '../../lib/shown-cache'

/** Each project's task types as last read: the Type field is there at once, not after a read. */
const shownTaskTypes = shownCache<PlanningTaskType[]>()

const TOKEN_WORDS: Record<QuickAddToken['kind'], string> = {
  get date() {
    return t('tasks:quickAddForm.token.date')
  },
  get label() {
    return t('tasks:quickAddForm.token.label')
  },
  get person() {
    return t('tasks:quickAddForm.token.person')
  },
  get priority() {
    return t('tasks:quickAddForm.token.priority')
  },
  get project() {
    return t('tasks:quickAddForm.token.project')
  }
}

/** A removed chip: its text stays in the title. Kept while the same text is still there. */
interface Ignored {
  start: number
  text: string
}

export interface QuickAddFormProps {
  /** The project chosen to start with: the current one, or the last used. */
  defaultProjectId?: string | null
  /** After a task is created. */
  onCreated?: () => void
  autoFocus?: boolean
  /** The Home field sits inline; the dialog puts it in a dialog. */
  variant?: 'inline' | 'dialog'
  /** Snip to task (N4.2a): the picture Add stores in the Library and attaches to the task. */
  snip?: SnipPreview | null
  /** Shows Cancel, which drops the snip. */
  onCancel?: () => void
}

const LAST_PROJECT_KEY = 'ostler.quickAdd.project'

function readLastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null // a convenience only
  }
}

function writeLastProject(projectId: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, projectId)
  } catch {
    // ignore -- see readLastProject
  }
}

/**
 * Quick add (P5.6): one line becomes a task. What `parseQuickAdd` finds is
 * shown as chips before Enter creates the task; removing a chip keeps its
 * words in the title instead.
 */
export function QuickAddForm({
  defaultProjectId,
  onCreated,
  autoFocus,
  variant = 'inline',
  snip: givenSnip = null,
  onCancel
}: QuickAddFormProps) {
  // Mark up (N4.2b) replaces the waiting snip; its preview follows here.
  const [snip, setSnip] = useState<SnipPreview | null>(givenSnip)
  const [markingUp, setMarkingUp] = useState(false)
  useEffect(() => setSnip(givenSnip), [givenSnip])
  const { projects, areas } = useOstler()
  const people = usePeople()
  const features = useFeatures()
  const navigate = useNavigate()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const open = projects.filter((project) => project.enabled)
  const [text, setText] = useState('')
  const [ignored, setIgnored] = useState<Ignored[]>([])
  const [chosenProjectId, setChosenProjectId] = useState<string>(() => {
    const wanted = defaultProjectId ?? readLastProject()
    return open.find((project) => project.id === wanted)?.id ?? open[0]?.id ?? ''
  })
  const [labels, setLabels] = useState<string[]>([])
  /** The chosen project's task types (N2.7a), and the one picked in the preview. */
  const [taskTypes, setTaskTypes] = useState<PlanningTaskType[]>(
    () => shownTaskTypes.get(chosenProjectId) ?? []
  )
  const [typeId, setTypeId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Add to My day (N1.4): kept ticked for the next task, until unticked.
  const [forMyDay, setForMyDay] = useState(false)
  const addToMyDay = useAddToMyDay()

  // A project chosen before the list had loaded, or one that went away.
  useEffect(() => {
    if (!open.some((project) => project.id === chosenProjectId) && open[0])
      setChosenProjectId(open[0].id)
  }, [open.map((project) => project.id).join(',')])

  const liveIgnored = ignored.filter(
    (entry) => text.slice(entry.start, entry.start + entry.text.length) === entry.text
  )
  const parsed = useMemo(
    () =>
      parseQuickAdd(text, {
        today: todayIsoDate(),
        locale: navigator.language,
        people: people.offered(chosenProjectId || null).map((person) => ({
          id: person.id,
          name: person.name,
          isMe: person.isMe
        })),
        labels,
        projects: open.map((project) => ({ id: project.id, name: project.name })),
        ignore: liveIgnored.map((entry) => entry.start)
      }),
    [
      text,
      people.offered(chosenProjectId || null),
      labels,
      open.length,
      liveIgnored.map((entry) => entry.start).join(',')
    ]
  )
  const projectId = parsed.projectId ?? chosenProjectId
  // Added to the project open behind it while one of its workstreams is open: into that workstream.
  const location = useLocation()
  const here = parseAppPath(location.pathname)
  const openSubprojectId =
    here?.kind === 'project' && here.projectId === projectId
      ? new URLSearchParams(location.search).get(SUBPROJECT_PARAM)
      : null
  // A task template (N2.1) the line is made from, if any; the project's own or every project's.
  const { templates } = useTaskTemplates(projectId || null)
  const [templateId, setTemplateId] = useState('')
  const template = templates.find((entry) => entry.id === templateId) ?? null
  // A type's template (N2.7b): picking the type picks its template, unless the
  // person picked one; the line's words still win over it.
  const [templateFromType, setTemplateFromType] = useState(false)
  const chooseTemplate = (id: string) => {
    setTemplateId(id)
    setTemplateFromType(false)
  }
  const chooseType = (id: string) => {
    setTypeId(id)
    if (templateId && !templateFromType) return
    const typeTemplate = taskTypes.find((type) => type.id === id)?.templateId ?? ''
    const usable = templates.some((entry) => entry.id === typeTemplate)
    setTemplateId(usable ? typeTemplate : '')
    setTemplateFromType(usable)
  }

  // The chosen project's labels, so #Admin reuses "admin" as it is spelled.
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void window.ostlerAPI.getPlanningLabels(projectId).then((result) => {
      if (!cancelled && result.ok) setLabels(result.value.map((label) => label.name))
    })
    // A type belongs to its project: another project starts with none picked.
    setTypeId('')
    setTemplateFromType(false)
    setTaskTypes(shownTaskTypes.get(projectId) ?? [])
    if (typeof window.ostlerAPI.getPlanningTaskTypes === 'function')
      void window.ostlerAPI.getPlanningTaskTypes(projectId).then((result) => {
        if (!result.ok) return
        shownTaskTypes.set(projectId, result.value)
        if (!cancelled) setTaskTypes(result.value)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!parsed.title && !template) {
      setError(t('tasks:quickAddForm.typeWhatTask'))
      return
    }
    if (!projectId) {
      setError(t('tasks:quickAddForm.addProjectFirstTasks'))
      return
    }
    setBusy(true)
    setError(null)
    // What you capture is yours unless you name someone (or the template
    // does): capture's one rule.
    const assigneeId = captureAssigneeId(
      parsed.assigneeId,
      template?.body.assigneeId ? null : (people.me?.id ?? null)
    )
    // With a task template (N2.1), the line's words fill only what they
    // name: a date or #label typed in the line wins over the template's.
    const result = template
      ? await window.ostlerAPI.useTaskTemplate(projectId, template.id, {
          ...(parsed.title ? { title: parsed.title } : {}),
          ...(parsed.labels.length > 0 ? { labels: parsed.labels } : {}),
          ...(parsed.priority ? { priority: parsed.priority } : {}),
          ...(assigneeId ? { assigneeId } : {}),
          ...(parsed.dueDate ? { targetDate: parsed.dueDate } : {}),
          ...(typeId ? { typeId } : {}),
          ...(openSubprojectId ? { subprojectId: openSubprojectId } : {})
        })
      : await window.ostlerAPI.createPlanningWorkItem(projectId, {
          title: parsed.title,
          labels: parsed.labels,
          ...(parsed.priority ? { priority: parsed.priority } : {}),
          ...(assigneeId ? { assigneeId } : {}),
          ...(parsed.dueDate ? { targetDate: parsed.dueDate } : {}),
          ...(typeId ? { typeId } : {}),
          ...(openSubprojectId ? { subprojectId: openSubprojectId } : {}),
          // A quick capture: To triage when the project asks (N4.3a).
          capture: snip ? 'snip' : 'quick-add'
        })
    if (!result.ok) {
      setBusy(false)
      setError(t('tasks:quickAddForm.couldntAddTask', { error: result.error }))
      return
    }
    writeLastProject(projectId)
    const project = open.find((entry) => entry.id === projectId)
    const task = 'workItem' in result.value ? result.value.workItem : result.value
    // The snip is written to disk only now, with its task (N4.2a).
    if (snip) {
      const saved = await window.ostlerAPI.saveSnipToTask(task.projectId, task.id, snip.snipId)
      if (!saved.ok)
        toast({
          title: t('tasks:quickAddForm.couldntSaveSnip', { error: saved.error }),
          tone: 'warning'
        })
    }
    setBusy(false)
    const dropped = 'dropped' in result.value ? droppedText(result.value.dropped) : null
    if (dropped)
      toast({ title: t('tasks:taskTemplates.someLeftOut'), body: dropped, tone: 'warning' })
    toast({
      title: task.inTriage
        ? t('tasks:triage.addedTo', { project: project?.name ?? '' })
        : project
          ? t('tasks:quickAddForm.taskAddedTo', { project: project.name })
          : t('tasks:quickAddForm.taskAddedToProject'),
      body: task.title,
      tone: 'success',
      action: {
        label: t('tasks:quickAddForm.open'),
        onClick: () =>
          navigate(
            task.inTriage
              ? projectPath(task.projectId, 'triage')
              : taskPath(task.projectId, task.id)
          )
      }
    })
    // A capture in To triage waits there; My day takes it once it is accepted.
    if (forMyDay && !task.inTriage) await addToMyDay(task)
    setText('')
    setIgnored([])
    setTemplateId('')
    setTemplateFromType(false)
    setTypeId('')
    onCreated?.()
    inputRef.current?.focus()
  }

  const unknown = parsed.unknown.map((entry) =>
    entry.kind === 'person'
      ? t('tasks:quickAddForm.noOneCalled', { entryText: entry.text })
      : t('tasks:quickAddForm.noProjectCalled', { entryText: entry.text })
  )

  return (
    <form className={`quick-add quick-add--${variant}`} onSubmit={(event) => void submit(event)}>
      {snip && (
        <div className="quick-add__snip-row">
          <img
            className="quick-add__snip"
            src={snip.thumbnail}
            alt={t('tasks:quickAddForm.snipPicture', { width: snip.width, height: snip.height })}
          />
          <Button
            size="sm"
            variant="secondary"
            icon={Highlighter}
            disabled={busy}
            onClick={() => setMarkingUp(true)}
          >
            {t('library:markup.markUp')}
          </Button>
          <MarkupEditor
            open={markingUp}
            title={t('library:markup.snipTitle')}
            saveLabel={t('library:markup.useThisPicture')}
            load={async () => {
              const picture = await window.ostlerAPI.getSnipFullPicture(snip.snipId)
              if (!picture.ok) throw new Error(picture.error)
              return picture.value
            }}
            onSave={async (png) => {
              const replaced = await window.ostlerAPI.replaceSnip(snip.snipId, png)
              if (!replaced.ok) return t('library:markup.couldntSave', { error: replaced.error })
              setSnip(replaced.value)
              setMarkingUp(false)
              return null
            }}
            onClose={() => setMarkingUp(false)}
          />
        </div>
      )}
      <div className="quick-add__row">
        <TextField
          ref={inputRef}
          label={t('tasks:quickAddForm.quickAddTask')}
          hideLabel
          className="quick-add__input"
          autoFocus={autoFocus}
          placeholder={
            template
              ? t('tasks:taskTemplates.quickAddPlaceholder', { name: template.name })
              : t('tasks:quickAddForm.addTaskLikePay')
          }
          value={text}
          error={error ?? undefined}
          onChange={(event) => {
            setText(event.target.value)
            setError(null)
          }}
        />
        <Select
          label={t('tasks:quickAddForm.project')}
          hideLabel
          className="quick-add__project"
          value={projectId}
          disabled={parsed.projectId !== null || open.length === 0}
          title={parsed.projectId ? t('tasks:quickAddForm.chosenProjectText') : undefined}
          onChange={(event) => setChosenProjectId(event.target.value)}
          options={
            open.length === 0
              ? [{ value: '', label: t('tasks:quickAddForm.noProjects') }]
              : projectSelectOptions(open, areas)
          }
        />
        <TaskTemplateSelect
          templates={templates}
          value={template ? template.id : ''}
          onChange={chooseTemplate}
          hideLabel
          className="quick-add__template"
        />
        <Checkbox
          label={t('views:myDay.quickAdd')}
          className="quick-add__my-day"
          checked={forMyDay}
          onChange={(event) => setForMyDay(event.target.checked)}
        />
        <Button type="submit" variant="primary" icon={Plus} loading={busy} disabled={busy}>
          {t('tasks:quickAddForm.addTask')}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {t('tasks:quickAddForm.cancel')}
          </Button>
        )}
        <TasksFromTextButton
          projectId={projectId}
          visible={features.ai && !snip}
          onAdded={onCreated}
        />
      </div>
      {(parsed.tokens.length > 0 || unknown.length > 0 || taskTypes.length > 0) && (
        <div className="quick-add__preview" aria-live="polite">
          <TaskTypeField
            size="sm"
            className="quick-add__type"
            types={taskTypes}
            value={typeId}
            onChange={chooseType}
          />
          {parsed.tokens.length > 0 && (
            <ul className="quick-add__chips" aria-label={t('tasks:quickAddForm.whatQuickAddFound')}>
              {parsed.tokens.map((token) => (
                <li key={`${token.start}-${token.kind}`}>
                  <Chip
                    onRemove={() =>
                      setIgnored((current) => [
                        ...current,
                        { start: token.start, text: token.text }
                      ])
                    }
                    removeText={t(`tasks:quickAddForm.removeToken.${token.kind}`, {
                      value: token.display,
                      text: token.text
                    })}
                  >
                    <span className="quick-add__chip-kind">{TOKEN_WORDS[token.kind]}</span>{' '}
                    {token.isNew
                      ? t('tasks:quickAddForm.newValue', { value: token.display })
                      : token.display}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
          {unknown.map((line) => (
            <p key={line} className="quick-add__unknown">
              {t('tasks:quickAddForm.staysTitle', { line })}
            </p>
          ))}
        </div>
      )}
    </form>
  )
}
