import { useConfig } from '../hooks/useConfig'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  ProjectTemplateSummary,
  RendererConfigUpdate,
  RendererProject,
  ThemeSetting
} from '@shared/ostler-api'
import { BLANK_TEMPLATE_ID, DEMO_TEMPLATE_IDS } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { projectFolder } from '@shared/project-folder'
import { isAiConfigured } from '@shared/ai-configured'
import { useOstler } from '../context/OstlerContext'
import { usePeople } from '../context/PeopleContext'
import { ImportFlow } from '../components/import/useImportDialog'
import { TemplatePicker } from '../components/TemplatePicker'
import { addDemoProjects } from '../hooks/sample-project'
import { AiSetupDialog } from '../views/settings/AiSetupDialog'
import { AgentSetupDialog } from '../views/settings/AgentSetupDialog'
import { useAppearance } from '../ui/theme/ThemeProvider'
import {
  Button,
  Icon,
  InlineAlert,
  ProgressBar,
  Radio,
  RadioGroup,
  TextField,
  Tooltip
} from '../ui'
import { Bot, Check, Folder, Hexagon, Sparkles } from '../ui/icons'
import { JoinFromOtherDevice } from '../devices/JoinFromOtherDevice'
import { usePersonalSpace } from '../devices/usePersonalSpace'
import { ThemePreview } from './ThemePreview'
import './Welcome.css'
import { t } from '@shared/i18n'

/** `join` is a way in from the start step, not one of the steps a start counts. */
type Step = 'hello' | 'start' | 'template' | 'extras' | 'join'
type Start = 'template' | 'blank' | 'import'

/** The steps a start goes through: only a template has one of its own, for choosing it. */
function stepsFor(start: Start): Step[] {
  return start === 'template'
    ? ['hello', 'start', 'template', 'extras']
    : ['hello', 'start', 'extras']
}

const THEMES: { value: ThemeSetting; label: string; hint: string }[] = [
  {
    value: 'system',
    get label() {
      return t('onboarding:welcome.system')
    },
    get hint() {
      return t('onboarding:welcome.followsWindows')
    }
  },
  {
    value: 'light',
    get label() {
      return t('onboarding:welcome.light')
    },
    get hint() {
      return t('onboarding:welcome.lightAllTime')
    }
  },
  {
    value: 'dark',
    get label() {
      return t('onboarding:welcome.dark')
    },
    get hint() {
      return t('onboarding:welcome.darkAllTime')
    }
  }
]

/**
 * The first-run welcome (P8.1), shown full-window while
 * `ui.firstRunCompleted` is false. It runs before any project exists, so it
 * uses only app-wide state: the config, people and the project list.
 *
 * 1. Your name (Me's name) and the theme, applied as you choose.
 * 2. How to start: a template, a blank project, or an import. Below a
 *    divider, the demo projects: they are added at once and the welcome ends
 *    in the simple one, skipping the rest.
 * 3. A template is chosen on a step of its own. This creates the project.
 * 4. Optional extras, each skippable: link a folder, set up Ostler AI, and
 *    (only with a folder linked) set up agents.
 *
 * The steps vary with the start, so a progress bar, not numbered steps, shows
 * how far along it is.
 *
 * "Skip for now" is always there. Before step 2 creates anything it creates
 * nothing; afterwards it finishes. Finishing lands in the new project.
 */
export function Welcome({
  version,
  onDone
}: {
  /** The running version: What's new waits for the next one. */
  version: string
  /** The welcome is over; `projectId` is where to land, or null for Home. */
  onDone: (projectId: string | null) => void
}) {
  const { projects, refreshProjects } = useOstler()
  const people = usePeople()
  const appearance = useAppearance()
  const [step, setStep] = useState<Step>('hello')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [start, setStart] = useState<Start>('template')
  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [blankName, setBlankName] = useState('')
  const [importing, setImporting] = useState(false)
  const [project, setProject] = useState<RendererProject | null>(null)
  const { config, setConfig } = useConfig()
  const [setup, setSetup] = useState<'ai' | 'agents' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  // The personal space, read while the join step is open; the join finishes once its first pull is in.
  const personal = usePersonalSpace({ enabled: step === 'join', intervalMs: 2000 })
  const joinFinished = useRef(false)

  // Each step starts with focus on its first control, so it runs from the keyboard.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [step, importing])

  // Me already exists, named after the Windows user; offer that name.
  useEffect(() => {
    if (!nameTouched && people.me) setName(people.me.name)
  }, [people.me, nameTouched])

  useEffect(() => {
    void window.ostlerAPI.listProjectTemplates().then((result) => {
      if (!result.ok) return
      const choices = result.value.filter(
        (template) => template.id !== BLANK_TEMPLATE_ID && !DEMO_TEMPLATE_IDS.includes(template.id)
      )
      setTemplates(choices)
      if (choices.length === 0) setStart((current) => (current === 'template' ? 'blank' : current))
      setTemplateId((current) => current ?? choices[0]?.id ?? null)
    })
  }, [])

  const finish = async (landOn: RendererProject | null) => {
    setBusy(true)
    const result = await window.ostlerAPI.updateConfig({
      ui: { firstRunCompleted: true, lastSeenVersion: version }
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await refreshProjects()
    onDone(landOn?.id ?? null)
  }

  // A PC that joined its personal space is set up once its first pull is in: its projects are here.
  useEffect(() => {
    const joined = personal.state?.on === true && personal.state.pulled
    if (step !== 'join' || !joined || joinFinished.current) return
    // Once only: `finish` is rebuilt each render, and this runs for the one join.
    joinFinished.current = true
    void finish(null)
  }, [step, personal.state])

  const saveName = async (): Promise<boolean> => {
    const trimmed = name.trim()
    if (!people.me || !trimmed || trimmed === people.me.name) return true
    const result = await window.ostlerAPI.updatePerson(people.me.id, { name: trimmed })
    if (!result.ok) {
      setError(result.error)
      return false
    }
    await people.refresh()
    return true
  }

  // Both demo projects come together; the welcome lands in the simple one and
  // ends there, since the extras are for a project of your own.
  const openDemos = async () => {
    setBusy(true)
    setError(null)
    const demos = await addDemoProjects(projects)
    setBusy(false)
    if (!demos.ok) {
      await refreshProjects()
      setError(demos.error)
      return
    }
    await finish(demos.value.simple)
  }

  const createProject = async () => {
    if (start === 'import') {
      setImporting(true)
      return
    }
    setBusy(true)
    setError(null)
    const template =
      start === 'template' ? templates.find((entry) => entry.id === templateId) : undefined
    const result = await window.ostlerAPI.createProject({
      name: start === 'template' ? (template?.name ?? '') : blankName.trim(),
      color: '',
      tags: [],
      notes: '',
      folder: null,
      ...(start === 'template' && template ? { templateId: template.id } : {})
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setProject(result.value.project)
    await refreshProjects()
    setStep('extras')
  }

  const linkFolder = async () => {
    if (!project) return
    setError(null)
    const picked = await window.ostlerAPI.browseForFolder(
      t('onboarding:welcome.chooseProjectFolder')
    )
    if (!picked.ok) {
      setError(picked.error)
      return
    }
    if (!picked.value) return
    const linked = await window.ostlerAPI.linkProjectFolder(project.id, picked.value)
    if (!linked.ok) {
      setError(t('onboarding:welcome.couldntLinkFolder', { error: linked.error }))
      return
    }
    setProject(linked.value)
  }

  const saveConfig = async (updates: RendererConfigUpdate) => {
    const result = await window.ostlerAPI.updateConfig(updates)
    if (!result.ok) throw new Error(result.error)
    setConfig(result.value)
  }

  const steps = stepsFor(start)
  const stepIndex = steps.indexOf(step)
  const startReady =
    start === 'blank' ? blankName.trim() !== '' : start === 'template' ? templates.length > 0 : true
  const templateReady = templates.some((entry) => entry.id === templateId)
  const folder = project ? projectFolder(project) : null
  const aiOn = config ? isAiConfigured(config.ai) : false

  if (importing) {
    return (
      <ImportFlow
        target={{ kind: 'new' }}
        onClose={() => setImporting(false)}
        onImported={(result) => {
          setImporting(false)
          void window.ostlerAPI.getProjects().then((projects) => {
            const imported = projects.ok
              ? projects.value.find((entry) => entry.id === result.projectId)
              : undefined
            if (imported) setProject(imported)
            setStep('extras')
          })
        }}
      />
    )
  }

  return (
    <div className="ostler-welcome">
      <main ref={panelRef} className="ostler-welcome-panel" aria-labelledby="ostler-welcome-title">
        <header className="ostler-welcome-header">
          <span className="ostler-welcome-logo">
            <Icon icon={Hexagon} size="lg" />
            {BRAND.name}
          </span>
          <Tooltip
            content={
              project
                ? t('onboarding:welcome.goProjectSkipRest')
                : t('onboarding:welcome.closeWelcomeWithoutCreating')
            }
          >
            <Button variant="ghost" disabled={busy} onClick={() => void finish(project)}>
              {t('onboarding:welcome.skipNow')}
            </Button>
          </Tooltip>
        </header>

        {step !== 'join' && (
          <ProgressBar
            className="ostler-welcome-progress"
            label={t('onboarding:welcome.progress')}
            value={stepIndex + 1}
            max={steps.length}
            valueText={t('onboarding:welcome.stepOf', {
              current: stepIndex + 1,
              total: steps.length
            })}
          />
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}

        {step === 'hello' && (
          <section className="ostler-welcome-step">
            <h1 id="ostler-welcome-title">{t('onboarding:welcome.welcome')}</h1>
            <p className="ostler-welcome-lead">{t('onboarding:welcome.planProjectsTasksBoards')}</p>
            <TextField
              label={t('onboarding:welcome.whatShouldWeCall')}
              hint={t('onboarding:welcome.tasksAssignYourselfShow')}
              value={name}
              maxLength={80}
              onChange={(event) => {
                setNameTouched(true)
                setName(event.target.value)
              }}
              data-autofocus
            />
            <fieldset className="ostler-welcome-themes">
              <legend>{t('onboarding:welcome.theme')}</legend>
              <div className="ostler-welcome-theme-list">
                {THEMES.map((theme) => (
                  <label
                    key={theme.value}
                    className={`ostler-welcome-theme${appearance.theme === theme.value ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="welcome-theme"
                      value={theme.value}
                      checked={appearance.theme === theme.value}
                      onChange={() => void appearance.setAppearance({ theme: theme.value })}
                    />
                    <ThemePreview theme={theme.value} />
                    <span className="ostler-welcome-theme-label">{theme.label}</span>
                    <span className="ostler-welcome-theme-hint">{theme.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <footer className="ostler-welcome-footer">
              <Button
                variant="primary"
                loading={busy}
                disabled={busy || name.trim() === ''}
                onClick={async () => {
                  setBusy(true)
                  const saved = await saveName()
                  setBusy(false)
                  if (saved) setStep('start')
                }}
              >
                {t('onboarding:welcome.continue')}
              </Button>
            </footer>
          </section>
        )}

        {step === 'start' && (
          <section className="ostler-welcome-step">
            <h1 id="ostler-welcome-title">{t('onboarding:welcome.howDoWantStart')}</h1>
            <RadioGroup legend={t('onboarding:welcome.firstProject')}>
              <Radio
                name="welcome-start"
                label={t('onboarding:welcome.startTemplate')}
                hint={t('onboarding:welcome.readyMadePlanSuch')}
                checked={start === 'template'}
                disabled={templates.length === 0}
                onChange={() => setStart('template')}
                {...(templates.length > 0 ? { 'data-autofocus': true } : {})}
              />
              <Radio
                name="welcome-start"
                label={t('onboarding:welcome.blankProject')}
                hint={t('onboarding:welcome.emptyProjectFillYourself')}
                checked={start === 'blank'}
                onChange={() => setStart('blank')}
                {...(templates.length === 0 ? { 'data-autofocus': true } : {})}
              />
              <Radio
                name="welcome-start"
                label={t('onboarding:welcome.import')}
                hint={t('onboarding:welcome.spreadsheetCsvTrelloBoard')}
                checked={start === 'import'}
                onChange={() => setStart('import')}
              />
            </RadioGroup>
            {start === 'blank' && (
              <TextField
                label={t('onboarding:welcome.projectName')}
                value={blankName}
                maxLength={80}
                placeholder={t('onboarding:welcome.websiteRelaunch')}
                onChange={(event) => setBlankName(event.target.value)}
              />
            )}
            <footer className="ostler-welcome-footer">
              <Button disabled={busy} onClick={() => setStep('hello')}>
                {t('onboarding:welcome.back')}
              </Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={busy || !startReady}
                onClick={() => (start === 'template' ? setStep('template') : void createProject())}
              >
                {start === 'template'
                  ? t('onboarding:welcome.next')
                  : start === 'import'
                    ? t('onboarding:welcome.chooseFile')
                    : t('onboarding:welcome.createProject')}
              </Button>
            </footer>
            <div className="ostler-welcome-demos">
              <Button disabled={busy} onClick={() => void openDemos()}>
                {t('onboarding:welcome.startWithDemos')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setStep('join')}>
                {t('onboarding:welcome.setUpFromOtherDevice')}
              </Button>
            </div>
          </section>
        )}

        {step === 'template' && (
          <section className="ostler-welcome-step">
            <h1 id="ostler-welcome-title">{t('onboarding:welcome.chooseTemplate')}</h1>
            <TemplatePicker templates={templates} value={templateId} onChange={setTemplateId} />
            <footer className="ostler-welcome-footer">
              <Button disabled={busy} onClick={() => setStep('start')}>
                {t('onboarding:welcome.back')}
              </Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={busy || !templateReady}
                onClick={() => void createProject()}
              >
                {t('onboarding:welcome.createProject')}
              </Button>
            </footer>
          </section>
        )}

        {step === 'join' && (
          <section className="ostler-welcome-step">
            <h1 id="ostler-welcome-title">{t('onboarding:welcome.joinTitle')}</h1>
            <p className="ostler-welcome-lead">{t('onboarding:welcome.joinLead')}</p>
            {personal.state ? (
              <JoinFromOtherDevice state={personal.state} onState={personal.setState} />
            ) : (
              personal.error && <InlineAlert tone="danger">{personal.error}</InlineAlert>
            )}
            <footer className="ostler-welcome-footer">
              <Button disabled={busy} onClick={() => setStep('start')}>
                {t('onboarding:welcome.back')}
              </Button>
            </footer>
          </section>
        )}

        {step === 'extras' && (
          <section className="ostler-welcome-step">
            <h1 id="ostler-welcome-title">{t('onboarding:welcome.fewOptionalExtras')}</h1>
            <p className="ostler-welcome-lead">
              {project
                ? t('onboarding:welcome.readyOptional', { projectName: project.name })
                : t('onboarding:welcome.eachTheseOptionalCan')}
            </p>
            <ul className="ostler-welcome-extras">
              <Extra
                icon={Folder}
                title={t('onboarding:welcome.softwareProject')}
                description={
                  folder
                    ? t('onboarding:welcome.linkedReadsNeverWrites', { folder })
                    : t('onboarding:welcome.linkFolderBrowseFiles')
                }
                done={folder !== null}
                action={
                  project && folder === null ? (
                    <Button onClick={() => void linkFolder()}>
                      {t('onboarding:welcome.linkFolder')}
                    </Button>
                  ) : null
                }
              />
              <Extra
                icon={Sparkles}
                title={t('onboarding:welcome.wantAiHelp')}
                description={
                  aiOn
                    ? t('onboarding:welcome.setUp')
                    : t('onboarding:welcome.canSuggestTasksBreak')
                }
                done={aiOn}
                action={
                  config && !aiOn ? (
                    <Button onClick={() => setSetup('ai')}>
                      {t('onboarding:welcome.setUpAi')}
                    </Button>
                  ) : null
                }
              />
              {folder !== null && (
                <Extra
                  icon={Bot}
                  title={t('onboarding:welcome.useAiAgents')}
                  description={
                    config?.harness.enabled
                      ? t('onboarding:welcome.agents')
                      : t('onboarding:welcome.agentsWorkThroughTasks')
                  }
                  done={config?.harness.enabled ?? false}
                  action={
                    config && !config.harness.enabled ? (
                      <Button onClick={() => setSetup('agents')}>
                        {t('onboarding:welcome.setUpAgents')}
                      </Button>
                    ) : null
                  }
                />
              )}
            </ul>
            <footer className="ostler-welcome-footer">
              <Button
                variant="primary"
                loading={busy}
                disabled={busy}
                onClick={() => void finish(project)}
                data-autofocus
              >
                {project ? t('onboarding:welcome.openProject') : t('onboarding:welcome.finish')}
              </Button>
            </footer>
          </section>
        )}
      </main>

      {setup === 'ai' && config && (
        <AiSetupDialog
          config={config}
          onClose={() => setSetup(null)}
          saveConfig={saveConfig}
          onKeyCleared={setConfig}
        />
      )}
      {setup === 'agents' && config && (
        <AgentSetupDialog
          config={config}
          onClose={() => setSetup(null)}
          saveConfig={saveConfig}
          onSetUpAi={() => setSetup('ai')}
        />
      )}
    </div>
  )
}

function Extra({
  icon,
  title,
  description,
  done,
  action
}: {
  icon: typeof Folder
  title: string
  description: string
  done: boolean
  action: ReactNode
}) {
  return (
    <li className="ostler-welcome-extra">
      <span className="ostler-welcome-extra-icon">
        <Icon icon={done ? Check : icon} />
      </span>
      <div className="ostler-welcome-extra-text">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </li>
  )
}
