import { useEffect, useRef, useState } from 'react'
import type {
  NewProjectDefaults,
  NewProjectFolder,
  NewProjectGitignoreTemplate,
  NewProjectLocationCheck,
  NewProjectResult,
  ProjectTemplateSummary,
  RendererProject
} from '@shared/ostler-api'
import { BLANK_TEMPLATE_ID, DEMO_TEMPLATE_IDS } from '@shared/ostler-api'
import {
  Button,
  Checkbox,
  Dialog,
  InlineAlert,
  Radio,
  RadioGroup,
  Select,
  TextArea,
  TextField
} from '../ui'
import { projectFolder } from '@shared/project-folder'
import './NewProjectWizard.css'
import { ProjectColorPicker } from './ProjectColorPicker'
import { ProjectIconPicker } from './ProjectIconPicker'
import { ProjectMark } from './ProjectMark'
import type { ProjectIcon } from '@shared/project-icons'
import { TemplatePicker } from './TemplatePicker'
import { addDemoProjects } from '../hooks/sample-project'
import { WizardSteps } from './WizardSteps'
import { ImportFlow } from './import/useImportDialog'
import { projectNameHint, proposeProjectName } from './project-name-hint'
import { useOstler } from '../context/OstlerContext'
import { useProjectStageNames } from '../hooks/useProjectStageNames'
import { projectStageName } from './project-stage-name'
import { t } from '@shared/i18n'
import { Trans } from '../i18n/Trans'

/**
 * Creating a project (D4). It starts with how to start: blank, from a
 * template (P5.8), the sample project, or an import (P6.1), which hands over
 * to the import dialog. Then where
 * the project lives: only in Ostler (the default, for most projects), in a
 * folder already on this PC, or in a new folder Ostler creates. Name and
 * colour come next, then create. A new folder adds today's setup step
 * (README, .gitignore, `git init`) and a review of exactly what will be
 * written before anything touches the disk.
 */
type Start = 'blank' | 'template' | 'sample' | 'import' | 'join'
type Place = 'ostler' | 'existing' | 'new'
type Step = 'start' | 'template' | 'place' | 'details' | 'setup' | 'review' | 'done'

const GITIGNORE_OPTIONS: { value: NewProjectGitignoreTemplate; label: string }[] = [
  {
    value: 'none',
    get label() {
      return t('projects:newProjectWizard.none')
    }
  },
  {
    value: 'general',
    get label() {
      return t('projects:newProjectWizard.generalOsFilesLogs')
    }
  },
  {
    value: 'node',
    get label() {
      return t('projects:newProjectWizard.nodeJs')
    }
  },
  {
    value: 'python',
    get label() {
      return t('projects:newProjectWizard.python')
    }
  },
  {
    value: 'dotnet',
    get label() {
      return t('projects:newProjectWizard.dotnet')
    }
  }
]

function stepsFor(start: Start, place: Place): Exclude<Step, 'done'>[] {
  // Import hands over to its own steps; the demo projects need no more answers.
  if (start === 'import' || start === 'sample' || start === 'join') return ['start']
  const first: Exclude<Step, 'done'>[] = start === 'template' ? ['start', 'template'] : ['start']
  return [
    ...first,
    ...(place === 'new'
      ? (['place', 'details', 'setup', 'review'] as const)
      : (['place', 'details'] as const))
  ]
}

/** A readable default folder name: "My New App" -> "my-new-app". */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The last segment of a Windows or POSIX path. */
function baseName(folderPath: string): string {
  return (
    folderPath
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  )
}

/** How often a join looks again for a shared folder that is not on this PC yet. */
const FOLDER_CHECK_MS = 15_000

export function NewProjectWizard({
  onClose,
  onCreated,
  onOpen,
  joinInviteId
}: {
  onClose: () => void
  /** Called once the project is registered, while the success step is showing. */
  onCreated: (project: RendererProject) => void | Promise<void>
  /** The success step's primary action. */
  onOpen: (project: RendererProject) => void
  /** An invite a join link left in main (prompt 07): the Join step opens filled in with it. */
  joinInviteId?: string
}) {
  const { projects } = useOstler()
  const [step, setStep] = useState<Step>('start')
  const [start, setStart] = useState<Start>('blank')
  // The invite a join is waiting on: its shared folder is not on this PC yet.
  const [waitingFor, setWaitingFor] = useState<string | null>(null)
  const joiningRef = useRef(false)
  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [place, setPlace] = useState<Place>('ostler')
  const [defaults, setDefaults] = useState<NewProjectDefaults | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [existingPath, setExistingPath] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [folderName, setFolderName] = useState('')
  const [check, setCheck] = useState<NewProjectLocationCheck | null>(null)

  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [color, setColor] = useState('')
  const [icon, setIcon] = useState<ProjectIcon | null>(null)
  // How to begin (D14): Start working now (Active, as before) or Plan it first (Planning).
  const [planFirst, setPlanFirst] = useState(false)
  const { names: stageNames } = useProjectStageNames()

  const [initGit, setInitGit] = useState(true)
  const [initialCommit, setInitialCommit] = useState(true)
  const [addReadme, setAddReadme] = useState(true)
  const [gitignore, setGitignore] = useState<NewProjectGitignoreTemplate>('general')

  const [result, setResult] = useState<NewProjectResult | null>(null)
  const checkSeq = useRef(0)
  const [importing, setImporting] = useState(false)
  const [invite, setInvite] = useState('')

  useEffect(() => {
    void (async () => {
      const res = await window.ostlerAPI.getNewProjectDefaults()
      if (!res.ok) {
        setError(res.error)
        return
      }
      setDefaults(res.value)
      setParentPath((current) => current || res.value.parentPath)
      setColor((current) => current || res.value.colors[0] || '')
      const list = await window.ostlerAPI.listProjectTemplates()
      if (list.ok) {
        // Blank and the demo projects are choices of their own.
        const choices = list.value.filter(
          (template) =>
            template.id !== BLANK_TEMPLATE_ID && !DEMO_TEMPLATE_IDS.includes(template.id)
        )
        setTemplates(choices)
        setTemplateId((current) => current ?? choices[0]?.id ?? null)
      }
      if (!res.value.gitAvailable) {
        setInitGit(false)
        setInitialCommit(false)
      } else if (!res.value.gitIdentityConfigured) {
        // Offered, not assumed: the commit would fail and leave a repository
        // agents cannot start from, so the human opts in knowingly.
        setInitialCommit(false)
      }
    })()
  }, [])

  // The name defaults to the template's or the folder's, until the human types their own.
  const folderLabel =
    place === 'existing' ? baseName(existingPath) : place === 'new' ? folderName : ''
  const chosenTemplate =
    start === 'template' ? (templates.find((template) => template.id === templateId) ?? null) : null
  const startLabel = start === 'template' ? (chosenTemplate?.name ?? '') : ''
  const suggestedName = startLabel || folderLabel
  // Proposed free of every project's name ("Website (2)"); the field says why.
  const proposedName = proposeProjectName(suggestedName, projects)
  useEffect(() => {
    if (!nameTouched) setName(proposedName)
  }, [proposedName, nameTouched])
  const nameHint = projectNameHint(name, projects, { proposedFrom: suggestedName })

  // Validate a new folder's path as it is typed, so "already exists" is
  // discovered on the first step and not after pressing Create.
  useEffect(() => {
    if (place !== 'new') return
    const seq = ++checkSeq.current
    const timer = setTimeout(() => {
      void (async () => {
        const res = await window.ostlerAPI.checkNewProjectLocation(parentPath, folderName)
        if (seq !== checkSeq.current) return
        setCheck(res.ok ? res.value : { projectPath: '', problem: res.error })
      })()
    }, 150)
    return () => clearTimeout(timer)
  }, [place, parentPath, folderName])

  const browse = async (title: string, apply: (folder: string) => void) => {
    setError(null)
    const res = await window.ostlerAPI.browseForFolder(title)
    if (!res.ok) setError(res.error)
    else if (res.value) apply(res.value)
  }

  const tags = tagsText
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

  const steps = stepsFor(start, place)
  const stepIndex = steps.indexOf(step as Exclude<Step, 'done'>)
  const isLastStep = stepIndex === steps.length - 1
  const trimmedName = name.trim()
  const locationProblem =
    place === 'new' && folderName.trim() && check?.problem ? check.problem : null
  const placeReady =
    place === 'ostler' ||
    (place === 'existing' && existingPath.trim().length > 0) ||
    (place === 'new' && folderName.trim().length > 0 && check !== null && check.problem === null)
  const stepReady =
    step === 'start' && start === 'join'
      ? invite.trim().length > 0 || joinInviteId !== undefined
      : step === 'place'
        ? placeReady
        : step === 'details'
          ? trimmedName.length > 0
          : step === 'template'
            ? chosenTemplate !== null
            : true
  const gitAvailable = defaults?.gitAvailable ?? true
  const identityMissing = gitAvailable && defaults?.gitIdentityConfigured === false

  const folderRequest = (): NewProjectFolder => {
    if (place === 'existing') return { kind: 'existing', path: existingPath.trim() }
    if (place === 'new') {
      return {
        kind: 'new',
        parentPath,
        folderName: folderName.trim(),
        initGit,
        addReadme,
        gitignore,
        initialCommit: initGit && initialCommit
      }
    }
    return null
  }

  // A join link opens this step filled in (prompt 07); it never joins by itself.
  useEffect(() => {
    if (!joinInviteId) return
    setStart('join')
    setStep('start')
    setError(null)
  }, [joinInviteId])

  // A shared project: main finds its folder on this PC and joins it. Until the folder is
  // there, the join is `waiting`, and the step looks again every FOLDER_CHECK_MS.
  const joinFrom = async (value: string, choose: boolean) => {
    joiningRef.current = true
    const joined = choose
      ? await window.ostlerAPI.joinShareChooseFolder(value)
      : await window.ostlerAPI.joinShare(value)
    joiningRef.current = false
    if (!joined.ok) {
      setBusy(false)
      setWaitingFor(null)
      setError(joined.error)
      return
    }
    // Cancelled: keep waiting for the folder, if the join was already waiting on it.
    if (joined.value === null) {
      setBusy(false)
      return
    }
    if ('waiting' in joined.value) {
      setBusy(false)
      setWaitingFor(value)
      return
    }
    setWaitingFor(null)
    const { projectId } = joined.value
    const list = await window.ostlerAPI.getProjects()
    const project = list.ok ? list.value.find((entry) => entry.id === projectId) : undefined
    setBusy(false)
    if (!project) {
      setError(t('projects:newProjectWizard.joinedProjectMissing'))
      return
    }
    setResult({
      project,
      createdFiles: [],
      gitInitialized: false,
      committed: false,
      warnings: []
    })
    setStep('done')
    await onCreated(project)
  }

  const joinFromRef = useRef(joinFrom)
  joinFromRef.current = joinFrom

  useEffect(() => {
    if (waitingFor === null) return
    const timer = setInterval(() => {
      if (!joiningRef.current) void joinFromRef.current(waitingFor, false)
    }, FOLDER_CHECK_MS)
    return () => clearInterval(timer)
  }, [waitingFor])

  const create = async () => {
    setBusy(true)
    setError(null)
    if (start === 'join') {
      await joinFrom(joinInviteId ?? invite.trim(), false)
      return
    }
    // Both demo projects come together, in Ostler only; the simple one opens.
    if (start === 'sample') {
      const demos = await addDemoProjects(projects)
      setBusy(false)
      if (!demos.ok) {
        setError(demos.error)
        return
      }
      setResult({
        project: demos.value.simple,
        createdFiles: [],
        gitInitialized: false,
        committed: false,
        warnings: []
      })
      setStep('done')
      await onCreated(demos.value.simple)
      return
    }
    try {
      const res = await window.ostlerAPI.createProject({
        name: trimmedName,
        color,
        icon,
        tags,
        notes: description,
        folder: folderRequest(),
        ...(start === 'template' && templateId ? { templateId } : {}),
        ...(planFirst ? { stage: 'planning' as const } : {})
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setResult(res.value)
      setStep('done')
      await onCreated(res.value.project)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const next = () => {
    setError(null)
    // Import has its own guided steps: the wizard hands over to it.
    if (step === 'start' && start === 'import') setImporting(true)
    else if (isLastStep) void create()
    else setStep(steps[stepIndex + 1])
  }

  const finished = step === 'done'
  const createdFolder = result ? projectFolder(result.project) : null
  if (importing)
    return (
      <ImportFlow
        target={{ kind: 'new' }}
        onClose={() => setImporting(false)}
        onImported={onClose}
      />
    )

  const footer = finished ? (
    <>
      <Button onClick={onClose}>{t('projects:newProjectWizard.close')}</Button>
      {result && (
        <Button variant="primary" onClick={() => onOpen(result.project)}>
          {t('projects:newProjectWizard.openProject')}
        </Button>
      )}
    </>
  ) : (
    <>
      <Button onClick={onClose} disabled={busy}>
        {t('projects:newProjectWizard.cancel')}
      </Button>
      {stepIndex > 0 && (
        <Button disabled={busy} onClick={() => setStep(steps[stepIndex - 1])}>
          {t('projects:newProjectWizard.back')}
        </Button>
      )}
      <Button variant="primary" loading={busy} disabled={busy || !stepReady} onClick={next}>
        {start === 'join'
          ? t('projects:newProjectWizard.joinProject')
          : isLastStep && start !== 'import'
            ? t('projects:newProjectWizard.createProject')
            : t('projects:newProjectWizard.next')}
      </Button>
    </>
  )

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={
        finished
          ? (result?.project.name ?? t('projects:newProjectWizard.projectCreated'))
          : t('projects:newProjectWizard.newProject')
      }
      description={
        finished
          ? undefined
          : t('projects:newProjectWizard.step', {
              number: stepIndex + 1,
              stepCount: steps.length,
              STEP_LABELS: STEP_LABELS[step]
            })
      }
      footer={footer}
      className="ostler-newproject-wizard"
    >
      <div className="ostler-newproject-body">
        {!finished && (
          <WizardSteps steps={steps.map((id) => STEP_LABELS[id])} current={stepIndex} />
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}

        {step === 'start' && (
          <RadioGroup legend={t('projects:newProjectWizard.howDoWantStart')}>
            <Radio
              name="new-project-start"
              label={t('projects:newProjectWizard.blank')}
              hint={t('projects:newProjectWizard.emptyProjectFillYourself')}
              checked={start === 'blank'}
              onChange={() => setStart('blank')}
              data-autofocus
            />
            <Radio
              name="new-project-start"
              label={t('projects:newProjectWizard.template')}
              hint={t('projects:newProjectWizard.readyMadePlanSuch')}
              checked={start === 'template'}
              disabled={templates.length === 0}
              onChange={() => setStart('template')}
            />
            <Radio
              name="new-project-start"
              label={t('projects:newProjectWizard.sampleProject')}
              hint={t('projects:newProjectWizard.shortTourWhoseTasks')}
              checked={start === 'sample'}
              onChange={() => setStart('sample')}
            />
            <Radio
              name="new-project-start"
              label={t('projects:newProjectWizard.importIntoNewProject')}
              hint={t('projects:newProjectWizard.spreadsheetCsvTrelloBoard')}
              checked={start === 'import'}
              onChange={() => setStart('import')}
            />
            <Radio
              name="new-project-start"
              label={t('projects:newProjectWizard.joinSharedProject')}
              hint={t('projects:newProjectWizard.joinSharedProjectHint')}
              checked={start === 'join'}
              onChange={() => setStart('join')}
            />
          </RadioGroup>
        )}

        {step === 'start' && start === 'join' && joinInviteId === undefined && (
          <TextArea
            label={t('projects:newProjectWizard.invite')}
            hint={t('projects:newProjectWizard.inviteHint')}
            value={invite}
            rows={2}
            spellCheck={false}
            onChange={(event) => setInvite(event.target.value)}
          />
        )}
        {step === 'start' && start === 'join' && joinInviteId !== undefined && (
          <p>{t('projects:newProjectWizard.joinFromLink')}</p>
        )}
        {step === 'start' && start === 'join' && busy && (
          <p>{t('projects:newProjectWizard.lookingForFolder')}</p>
        )}
        {step === 'start' && start === 'join' && waitingFor !== null && !busy && (
          <>
            <p>{t('projects:newProjectWizard.folderNotFound')}</p>
            <Button
              onClick={() => {
                setBusy(true)
                setError(null)
                void joinFrom(waitingFor, true)
              }}
            >
              {t('projects:newProjectWizard.chooseFolderMyself')}
            </Button>
          </>
        )}

        {step === 'template' && (
          <TemplatePicker templates={templates} value={templateId} onChange={setTemplateId} />
        )}

        {step === 'place' && (
          <>
            <RadioGroup legend={t('projects:newProjectWizard.whereDoesProjectLive')}>
              <Radio
                name="new-project-place"
                label={t('projects:newProjectWizard.justOstler')}
                hint={t('projects:newProjectWizard.mostProjectsPlansTasks')}
                checked={place === 'ostler'}
                onChange={() => setPlace('ostler')}
              />
              <Radio
                name="new-project-place"
                label={t('projects:newProjectWizard.folderPc')}
                hint={t('projects:newProjectWizard.pickFolderAlreadyExists')}
                checked={place === 'existing'}
                onChange={() => setPlace('existing')}
              />
              <Radio
                name="new-project-place"
                label={t('projects:newProjectWizard.newFolder')}
                hint={t('projects:newProjectWizard.ostlerCreatesFolderReadme')}
                checked={place === 'new'}
                onChange={() => setPlace('new')}
              />
            </RadioGroup>

            {place === 'existing' && (
              <div className="ostler-newproject-row">
                <TextField
                  label={t('projects:newProjectWizard.folder')}
                  value={existingPath}
                  onChange={(event) => setExistingPath(event.target.value)}
                  spellCheck={false}
                  placeholder={t('projects:newProjectWizard.cUsersDocumentsProject')}
                />
                <Button
                  onClick={() =>
                    void browse(t('projects:newProjectWizard.chooseProjectFolder'), setExistingPath)
                  }
                >
                  {t('projects:newProjectWizard.browse')}
                </Button>
              </div>
            )}

            {place === 'new' && (
              <>
                <div className="ostler-newproject-row">
                  <TextField
                    label={t('projects:newProjectWizard.create')}
                    value={parentPath}
                    onChange={(event) => setParentPath(event.target.value)}
                    spellCheck={false}
                  />
                  <Button
                    onClick={() =>
                      void browse(
                        t('projects:newProjectWizard.chooseWhereCreateProject'),
                        setParentPath
                      )
                    }
                  >
                    {t('projects:newProjectWizard.browse')}
                  </Button>
                </div>
                <TextField
                  label={t('projects:newProjectWizard.folderName')}
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  spellCheck={false}
                  placeholder={slugify(t('projects:newProjectWizard.myNewProject'))}
                  error={locationProblem ?? undefined}
                  hint={
                    check?.projectPath && !locationProblem && folderName.trim()
                      ? t('projects:newProjectWizard.willCreated', {
                          projectPath: check.projectPath
                        })
                      : undefined
                  }
                />
              </>
            )}
          </>
        )}

        {step === 'details' && (
          <>
            <TextField
              label={t('projects:newProjectWizard.projectName')}
              value={name}
              onChange={(event) => {
                setNameTouched(true)
                setName(event.target.value)
              }}
              placeholder={t('projects:newProjectWizard.websiteRelaunch')}
              maxLength={80}
              hint={nameHint}
              data-autofocus
            />
            <ProjectColorPicker
              colors={defaults?.colors ?? []}
              value={color}
              onChange={setColor}
              name="new-project-color"
            />
            <ProjectIconPicker
              value={icon}
              onChange={setIcon}
              name="new-project-icon"
              color={color}
            />
            <TextArea
              label={t('projects:newProjectWizard.description')}
              hint={
                place === 'new'
                  ? t('projects:newProjectWizard.optionalSavedProjectNotes')
                  : t('projects:newProjectWizard.optionalSavedProjectNotes2')
              }
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
            />
            <TextField
              label={t('projects:newProjectWizard.tags')}
              hint={t('projects:newProjectWizard.optionalSeparatedCommas')}
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
            />
            {/* Only blank and template starts reach this step. */}
            <RadioGroup legend={t('projects:newProjectWizard.beginLabel')}>
              <Radio
                name="new-project-begin"
                label={t('projects:newProjectWizard.beginWork')}
                hint={t('projects:newProjectWizard.beginWorkHint', {
                  name: projectStageName('active', stageNames)
                })}
                checked={!planFirst}
                onChange={() => setPlanFirst(false)}
              />
              <Radio
                name="new-project-begin"
                label={t('projects:newProjectWizard.beginPlan')}
                hint={t('projects:newProjectWizard.beginPlanHint', {
                  name: projectStageName('planning', stageNames)
                })}
                checked={planFirst}
                onChange={() => setPlanFirst(true)}
              />
            </RadioGroup>
          </>
        )}

        {step === 'setup' && (
          <>
            <Checkbox
              label={t('projects:newProjectWizard.initializeGitRepository')}
              hint={
                gitAvailable
                  ? t('projects:newProjectWizard.agentsWorkTheirOwn')
                  : t('projects:newProjectWizard.gitWasNotFound')
              }
              checked={initGit}
              disabled={!gitAvailable}
              onChange={(event) => setInitGit(event.target.checked)}
            />
            <Checkbox
              label={t('projects:newProjectWizard.makeInitialCommit')}
              hint={t('projects:newProjectWizard.agentsStartLatestCommit')}
              checked={initGit && initialCommit}
              disabled={!initGit}
              onChange={(event) => setInitialCommit(event.target.checked)}
            />
            {initGit && identityMissing && (
              <InlineAlert tone="warning">
                {t('projects:newProjectWizard.gitHasNoUser')}
              </InlineAlert>
            )}
            <Checkbox
              label={t('projects:newProjectWizard.addReadmeMd')}
              checked={addReadme}
              onChange={(event) => setAddReadme(event.target.checked)}
            />
            <Select
              label={t('projects:newProjectWizard.gitignore')}
              value={gitignore}
              options={GITIGNORE_OPTIONS}
              onChange={(event) => setGitignore(event.target.value as NewProjectGitignoreTemplate)}
            />
          </>
        )}

        {step === 'review' && (
          <>
            <p>{t('projects:newProjectWizard.ostlerWillCreateFolder')}</p>
            <table className="ostler-newproject-table">
              <tbody>
                <tr>
                  <th>{t('projects:newProjectWizard.name')}</th>
                  <td>
                    {icon ? (
                      <ProjectMark project={{ color, icon }} />
                    ) : (
                      <span
                        className="ostler-newproject-swatch"
                        style={{ backgroundColor: color }}
                      />
                    )}
                    {trimmedName}
                  </td>
                </tr>
                <tr>
                  <th>{t('projects:newProjectWizard.folder')}</th>
                  <td>
                    <code>{check?.projectPath}</code>
                  </td>
                </tr>
                {tags.length > 0 && (
                  <tr>
                    <th>{t('projects:newProjectWizard.tags')}</th>
                    <td>{tags.join(', ')}</td>
                  </tr>
                )}
                <tr>
                  <th>{t('projects:newProjectWizard.git')}</th>
                  <td>
                    {!initGit
                      ? t('projects:newProjectWizard.notGitRepositoryAgents')
                      : initialCommit
                        ? t('projects:newProjectWizard.newRepositoryInitialCommit')
                        : t('projects:newProjectWizard.newRepositoryNoCommits')}
                  </td>
                </tr>
                <tr>
                  <th>{t('projects:newProjectWizard.files')}</th>
                  <td>
                    {[addReadme && 'README.md', gitignore !== 'none' && '.gitignore']
                      .filter(Boolean)
                      .join(', ') || t('projects:newProjectWizard.noneEmptyFolder')}
                  </td>
                </tr>
              </tbody>
            </table>
            {initGit && !initialCommit && (
              <InlineAlert tone="warning">
                {t('projects:newProjectWizard.noCommitAgentsCant')}
              </InlineAlert>
            )}
          </>
        )}

        {step === 'done' && result && (
          <>
            {createdFolder === null ? (
              <p>{t('projects:newProjectWizard.projectLivesOstlerUse')}</p>
            ) : (
              <p>
                <Trans
                  i18nKey="projects:newProjectWizard.addedWithFolder"
                  values={{ folder: createdFolder }}
                  components={{ code: <code /> }}
                />
              </p>
            )}
            {(result.gitInitialized || result.committed || result.createdFiles.length > 0) && (
              <ul className="ostler-newproject-list">
                {result.gitInitialized && (
                  <li>{t('projects:newProjectWizard.gitRepositoryInitialized')}</li>
                )}
                {result.committed && <li>{t('projects:newProjectWizard.initialCommitMade')}</li>}
                {result.createdFiles.map((file) => (
                  <li key={file}>
                    <Trans
                      i18nKey="projects:newProjectWizard.wroteFile"
                      values={{ file }}
                      components={{ code: <code /> }}
                    />
                  </li>
                ))}
              </ul>
            )}
            {result.warnings.map((warning) => (
              <InlineAlert key={warning} tone="warning">
                {warning}
              </InlineAlert>
            ))}
          </>
        )}
      </div>
    </Dialog>
  )
}

const STEP_LABELS: Record<Step, string> = {
  get start() {
    return t('projects:newProjectWizard.howStart')
  },
  get template() {
    return t('projects:newProjectWizard.template2')
  },
  get place() {
    return t('projects:newProjectWizard.whereLives')
  },
  get details() {
    return t('projects:newProjectWizard.nameColour')
  },
  get setup() {
    return t('projects:newProjectWizard.folderSetup')
  },
  get review() {
    return t('projects:newProjectWizard.review')
  },
  get done() {
    return t('projects:newProjectWizard.done')
  }
}
