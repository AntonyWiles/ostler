import { useConfig } from '../hooks/useConfig'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  type AgentUsageLimits,
  MAX_PROJECT_CONVENTIONS_LENGTH,
  type EstimateUnit,
  type ProjectAiSettings,
  type ProjectAutoDispatchConfig,
  type AIProvider,
  type RendererProject
} from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { projectFolder } from '@shared/project-folder'
import { capabilitiesOf } from '@shared/share-roles'
import type { AgentSetupSetting, ResolvedSetup } from '@shared/workspace-setup'
import { MAX_TRY_COMMAND_LENGTH } from '@shared/try-it'
import { useFeatures } from '../navigation/features'
import {
  Button,
  Dialog,
  Icon,
  InlineAlert,
  NumberField,
  Section,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  Tabs,
  TextArea,
  TextField,
  useToast
} from '../ui'
import { CircleCheck } from '../ui/icons'
import { ProjectColorPicker } from './ProjectColorPicker'
import { PeopleList } from '../views/settings/sections/PeopleList'
import { ProjectIconPicker } from './ProjectIconPicker'
import { ProjectLessonsGroup } from './ProjectLessonsGroup'
import type { ProjectIcon } from '@shared/project-icons'
import { normalizeProjectStage, PROJECT_STAGES, type ProjectStage } from '@shared/project-stages'
import { projectStageName } from './project-stage-name'
import { useProjectStageNames } from '../hooks/useProjectStageNames'
import { useSavedDraft } from '../hooks/useSavedDraft'
import { StatusUpdateReminderFields } from './status-updates/StatusUpdateReminderFields'
import { TriageSetting } from '../views/planning/triage/TriageSetting'
import type { UpdateReminder } from '@shared/status-updates'
import { ProjectBudgetRow } from '../costs/ProjectBudgetRow'
import { ProjectBillingFields } from '../billing/ProjectBillingFields'
import { ProjectLabelsManager } from './ProjectLabelsManager'
import { ProjectFieldsManager } from './ProjectFieldsManager'
import { ProjectTaskTypesManager } from '../task-types/ProjectTaskTypesManager'
import { ProjectColumnsManager } from './ProjectColumnsManager'
import { CustomiseBoardLink } from '../views/planning/board-layout/CustomiseBoardLink'
import { ProjectGithubRepository } from '../github/ProjectGithubRepository'
import { ProjectTaskPrefix } from './ProjectTaskPrefix'
import { ProjectRulesManager } from '../rules/ProjectRulesManager'
import { agentColumnsLocked } from '@shared/board-columns'
import { renameProject } from './ProjectActions'
import { projectNameHint } from './project-name-hint'
import { useOstler } from '../context/OstlerContext'
import {
  AGENT_DEFAULT_MODELS as DEFAULT_MODELS,
  AGENT_PROVIDER_OPTIONS as PROVIDER_OPTIONS
} from '../views/settings/agent-model-options'
import { EffortField } from '../views/settings/EffortField'
import { agentEffortConnection, resolveAgentModel } from '@shared/agent-model'
import './ProjectSettingsDialog.css'
import { t } from '@shared/i18n'
import { formatNumber } from '@shared/format'
import { normalizeAgentLimits } from '@shared/agent-run-history'
import type { ProjectBackupEntry, ProjectRemovalPurge } from '@shared/ostler-api'
import { ProjectSharingPanel } from './ProjectSharingPanel'
import { ProjectWebhooksPanel } from './ProjectWebhooksPanel'
import { ProjectBackupPanel } from './project-care/ProjectBackupPanel'
import { ProjectCheckPanel } from './project-care/ProjectCheckPanel'
import { ProjectExportImportPanel } from './project-care/ProjectExportImportPanel'
import { ProjectRemovePanel } from './project-care/ProjectRemovePanel'
import { DemoRemovePanel } from './project-care/DemoRemovePanel'
import { ProjectRemovedDialog } from './project-care/ProjectRemovedSummary'
import './project-care/ProjectCare.css'

interface ProjectSettingsDialogProps {
  project: RendererProject
  onClose: () => void
  /** Called after every saved change, so lists showing the project refresh. */
  onChanged: () => void
  /**
   * An agent's suggested try command (N9.4), filled into Try command for the
   * person to save. Nothing is saved until they do.
   */
  suggestedTryCommand?: string
  /** The section to open on: Agents with a suggested try command, else General. */
  section?: ProjectSettingsSection
}

/** The dialog's sections, one shown at a time. */
export type ProjectSettingsSection =
  | 'general'
  | 'tasks'
  | 'people'
  | 'board'
  | 'budget'
  | 'folder'
  | 'sharing'
  | 'agents'
  | 'backup'
  | 'check'
  | 'exportImport'
  | 'remove'

/** Looking after the project's data: a group of their own, under the settings. */
const CARE_SECTIONS = ['backup', 'check', 'exportImport', 'remove'] as const

function isCareSection(section: ProjectSettingsSection): boolean {
  return (CARE_SECTIONS as readonly string[]).includes(section)
}

/**
 * One project's settings, a section at a time with every section down the
 * side: General (name, colour, stage and the like), Tasks, Board, Budget,
 * Folder and GitHub, and, while agents are on, how agents run here. Changes
 * save as they are made. Below them, looking after the project's data:
 * Backup, Check and repair, Export and import, and Remove.
 */
export function ProjectSettingsDialog({
  project,
  onClose,
  onChanged,
  suggestedTryCommand,
  section: openOn
}: ProjectSettingsDialogProps) {
  const features = useFeatures()
  const { toastUndo } = useToast()
  const stageNames = useProjectStageNames()
  const [current, setCurrent] = useState(project)
  const { projects, areas } = useOstler()
  const [name, setName] = useState(project.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [colors, setColors] = useState<string[]>([])
  const [autoRun, setAutoRun] = useState<ProjectAutoDispatchConfig | null>(null)
  const [aiSettings, setAiSettings] = useState<ProjectAiSettings | null>(null)
  // Ostler AI is set up: one switch for every project, with no per-project one.
  const aiSetUp = features.ai
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [section, setSection] = useState<ProjectSettingsSection>(
    openOn ?? (suggestedTryCommand !== undefined ? 'agents' : 'general')
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const folder = projectFolder(current)
  // The care sections load what they show, so each mounts the first time it is shown.
  const [visited, setVisited] = useState<ReadonlySet<ProjectSettingsSection>>(
    () => new Set([section])
  )
  // A Viewer of a shared project can't change what its members share (name, colour, icon).
  const [viewer, setViewer] = useState(false)
  const [removed, setRemoved] = useState<{
    purge: ProjectRemovalPurge
    backup: ProjectBackupEntry | null
  } | null>(null)

  useEffect(() => {
    void window.ostlerAPI.getNewProjectDefaults().then((result) => {
      if (result.ok) setColors(result.value.colors)
    })
    void window.ostlerAPI.getProjectAutoDispatchConfig(project.id).then((result) => {
      if (result.ok) setAutoRun(result.value)
    })
    void window.ostlerAPI.getProjectAISettings(project.id).then((result) => {
      if (result.ok) setAiSettings(result.value)
    })
    void window.ostlerAPI.getShareState(project.id).then((result) => {
      setViewer(
        result.ok && !!result.value && !capabilitiesOf(result.value.myRole).editProjectSettings
      )
    })
  }, [project.id])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(timer)
  }, [saved])

  const done = (updated?: RendererProject) => {
    if (updated) setCurrent(updated)
    setError(null)
    setSaved(true)
    onChanged()
  }

  const saveName = async () => {
    const problem = await renameProject(current, name)
    if (problem) {
      setNameError(problem)
      return
    }
    if (name.trim() !== current.name) done({ ...current, name: name.trim() })
  }

  const saveColour = async (color: string) => {
    const result = await window.ostlerAPI.updateProject(current.id, { color })
    if (result.ok) done(result.value)
    else setError(result.error)
  }

  // Area and icon (N5.1) save as they are chosen, like the colour.
  // The stage (N5.3) saves the same way.
  // An archived project is turned back on from Remove.
  const saveEnabled = async (enabled: boolean) => {
    const result = await window.ostlerAPI.updateProject(current.id, { enabled })
    if (result.ok) done(result.value)
    else setError(result.error)
  }

  const saveAppearance = async (updates: {
    areaId?: string | null
    icon?: ProjectIcon | null
    stage?: ProjectStage
    updateReminder?: UpdateReminder
  }) => {
    const result = await window.ostlerAPI.updateProject(current.id, updates)
    if (result.ok) done(result.value)
    else setError(result.error)
  }

  const linkFolder = async () => {
    const picked = await window.ostlerAPI.browseForFolder(
      t('projects:projectSettingsDialog.chooseFolder', { currentName: current.name })
    )
    if (!picked.ok) return setError(picked.error)
    if (!picked.value) return
    const linked = await window.ostlerAPI.linkProjectFolder(current.id, picked.value)
    if (linked.ok) done(linked.value)
    else setError(linked.error)
  }

  // Unlinking is undone by linking the same folder again, so it happens at
  // once and offers undo.
  const unlinkFolder = async () => {
    const was = folder
    const unlinked = await window.ostlerAPI.unlinkProjectFolder(current.id)
    if (!unlinked.ok) return setError(unlinked.error)
    done(unlinked.value)
    if (was) {
      toastUndo(
        t('projects:projectSettingsDialog.unlinkedFolder', { currentName: current.name }),
        async () => {
          const relinked = await window.ostlerAPI.linkProjectFolder(current.id, was)
          if (relinked.ok) done(relinked.value)
          else setError(relinked.error)
        }
      )
    }
  }

  const saveEstimateUnit = async (estimateUnit: EstimateUnit) => {
    const result = await window.ostlerAPI.updateProject(current.id, { estimateUnit })
    if (result.ok) done(result.value)
    else setError(result.error)
  }
  const labelsSaved = useCallback(() => {
    setError(null)
    setSaved(true)
  }, [])

  const saveAiSettings = async (updates: {
    profileSetting?: ProjectAiSettings['profileSetting']
  }) => {
    const result = await window.ostlerAPI.updateProjectAISettings(current.id, updates)
    if (!result.ok) return setError(result.error)
    setAiSettings(result.value)
    done({
      ...current,
      aiProfile: result.value.profileSetting
    })
  }

  const saveAutoRun = async (updates: Partial<ProjectAutoDispatchConfig>) => {
    const result = await window.ostlerAPI.updateProjectAutoDispatchConfig(current.id, updates)
    if (result.ok) {
      setAutoRun(result.value)
      done()
    } else setError(result.error)
  }

  const sections: ProjectSettingsSection[] = [
    'general',
    'tasks',
    'people',
    'board',
    'budget',
    'folder',
    'sharing',
    ...(features.agents ? (['agents'] as const) : []),
    ...CARE_SECTIONS
  ]
  const shown = sections.includes(section) ? section : 'general'

  const panel = (value: ProjectSettingsSection): ReactNode => {
    switch (value) {
      case 'general':
        return (
          <>
            <Group title={t('projects:projectSettingsDialog.nameColour')}>
              {viewer && (
                <InlineAlert tone="info">
                  {t('projects:projectSettingsDialog.viewerSharedSettings')}
                </InlineAlert>
              )}
              <fieldset className="project-settings-shared" disabled={viewer}>
                <TextField
                  label={t('projects:projectSettingsDialog.projectName')}
                  value={name}
                  maxLength={80}
                  error={nameError ?? undefined}
                  hint={projectNameHint(name, projects, { exceptId: project.id })}
                  onChange={(event) => {
                    setName(event.target.value)
                    setNameError(null)
                  }}
                  onBlur={() => void saveName()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveName()
                  }}
                />
                {colors.length > 0 && (
                  <ProjectColorPicker
                    colors={colors}
                    value={current.color}
                    onChange={(color) => void saveColour(color)}
                    name={`project-settings-colour-${current.id}`}
                  />
                )}
                <ProjectIconPicker
                  value={current.icon ?? null}
                  onChange={(icon) => void saveAppearance({ icon })}
                  name={`project-settings-icon-${current.id}`}
                  color={current.color}
                />
              </fieldset>
              {(areas ?? []).length > 0 && (
                <Select
                  label={t('projects:areas.area')}
                  value={current.areaId ?? ''}
                  onChange={(event) => void saveAppearance({ areaId: event.target.value || null })}
                  options={[
                    ...(areas ?? []).map((area) => ({ value: area.id, label: area.name })),
                    { value: '', label: t('projects:areas.noArea') }
                  ]}
                />
              )}
              <Select
                label={t('projects:projectStages.stage')}
                hint={t('projects:projectStages.stageHint')}
                value={normalizeProjectStage(current.stage)}
                onChange={(event) =>
                  void saveAppearance({ stage: event.target.value as ProjectStage })
                }
                options={PROJECT_STAGES.map((stage) => ({
                  value: stage,
                  label: projectStageName(stage, stageNames.names)
                }))}
              />
              <StatusUpdateReminderFields
                value={current.updateReminder}
                onChange={(updateReminder) => void saveAppearance({ updateReminder })}
              />
              <TriageSetting project={current} onSaved={done} onError={setError} />
            </Group>

            {aiSetUp && aiSettings && (
              <Group title={BRAND.aiName}>
                <SegmentedControl
                  label={t('projects:projectSettingsDialog.kindProject')}
                  value={aiSettings.profileSetting}
                  onChange={(profileSetting) => void saveAiSettings({ profileSetting })}
                  options={[
                    {
                      value: 'auto',
                      label:
                        aiSettings.profile === 'software'
                          ? t('projects:projectSettingsDialog.autoSoftware')
                          : t('projects:projectSettingsDialog.autoGeneral')
                    },
                    { value: 'software', label: t('projects:projectSettingsDialog.software') },
                    { value: 'general', label: t('projects:projectSettingsDialog.general') }
                  ]}
                />
                <p className="ostler-project-settings-muted">
                  {t('projects:projectSettingsDialog.autoSoftwareWhenLinked')}
                </p>
              </Group>
            )}
          </>
        )
      case 'tasks':
        return (
          <>
            <Group
              title={t('projects:projectSettingsDialog.estimates')}
              description={t('projects:projectSettingsDialog.howProjectsTaskEstimates')}
            >
              <SegmentedControl
                label={t('projects:projectSettingsDialog.estimate')}
                value={current.estimateUnit ?? 'points'}
                onChange={(unit) => void saveEstimateUnit(unit)}
                options={[
                  { value: 'points', label: t('projects:projectSettingsDialog.points') },
                  { value: 'hours', label: t('projects:projectSettingsDialog.hours') }
                ]}
              />
            </Group>

            <Group
              title={t('projects:taskPrefix.title')}
              description={t('projects:taskPrefix.description')}
            >
              <ProjectTaskPrefix project={current} onSaved={done} />
            </Group>

            <Group
              title={t('projects:projectSettingsDialog.labels')}
              description={t('projects:projectSettingsDialog.labelsProjectsTasksColour')}
            >
              <ProjectLabelsManager
                projectId={current.id}
                onError={setError}
                onSaved={labelsSaved}
              />
            </Group>

            <Group
              title={t('projects:projectSettingsDialog.taskTypes')}
              description={t('projects:projectSettingsDialog.taskTypesDescription')}
            >
              <ProjectTaskTypesManager
                projectId={current.id}
                onError={setError}
                onSaved={labelsSaved}
              />
            </Group>

            <Group
              title={t('projects:projectSettingsDialog.fields')}
              description={t('projects:projectSettingsDialog.fieldsDescription')}
            >
              <ProjectFieldsManager
                projectId={current.id}
                onError={setError}
                onSaved={labelsSaved}
              />
            </Group>
          </>
        )
      case 'board':
        return (
          <>
            {/* Views, toolbar and options live on the Board itself, in Customise board. */}
            <Group
              title={t('tasks:boardLayout.title')}
              description={t('tasks:boardLayout.projectSettingsHint')}
            >
              <div>
                <CustomiseBoardLink projectId={current.id} onOpen={onClose} />
              </div>
            </Group>

            <Group
              title={t('projects:boardColumns.title')}
              description={t('projects:boardColumns.description')}
            >
              <ProjectColumnsManager
                projectId={current.id}
                agentsLocked={agentColumnsLocked(features.agents, folder !== null)}
                onError={setError}
                onSaved={labelsSaved}
              />
            </Group>

            <Group title={t('projects:rules.title')} description={t('projects:rules.description')}>
              <ProjectRulesManager
                projectId={current.id}
                onError={setError}
                onSaved={labelsSaved}
              />
            </Group>

            {autoRun && (
              <Group title={t('projects:projectSettingsDialog.board')}>
                <NumberField
                  label={t('projects:projectSettingsDialog.archiveDoneTasksAfter')}
                  unit={t('common:unit.days')}
                  min={0}
                  max={3650}
                  value={autoRun.autoArchiveDoneAfterDays ?? 0}
                  hint={t('projects:projectSettingsDialog.doneTasksMoveArchive')}
                  onChange={(days) => {
                    if (days !== null)
                      void saveAutoRun({ autoArchiveDoneAfterDays: Math.floor(days) })
                  }}
                />
              </Group>
            )}
          </>
        )
      case 'people':
        // The project's own people (migration 78): offered only here, and gone with the project.
        return (
          <Group
            title={t('projects:projectSettingsDialog.projectPeople')}
            description={t('projects:projectSettingsDialog.projectPeopleDescription')}
          >
            <PeopleList
              projectId={current.id}
              label={t('projects:projectSettingsDialog.projectPeople')}
              onSaved={() => done()}
              onError={setError}
            />
          </Group>
        )
      case 'budget':
        return (
          <Group
            title={t('projects:costs.budget')}
            description={t('projects:costs.budgetSettingsDescription')}
          >
            <ProjectBudgetRow projectId={current.id} />
            <ProjectBillingFields projectId={current.id} />
          </Group>
        )
      case 'folder':
        return (
          <>
            <Group
              title={t('projects:projectSettingsDialog.folder')}
              description={t('projects:projectSettingsDialog.folderOptionalLinkOne')}
            >
              {folder ? (
                <div className="ostler-project-settings-folder">
                  <span className="ostler-project-settings-path" title={folder}>
                    {folder}
                  </span>
                  <Button onClick={() => void unlinkFolder()}>
                    {t('projects:projectSettingsDialog.unlinkFolder')}
                  </Button>
                </div>
              ) : (
                <div className="ostler-project-settings-folder">
                  <span className="ostler-project-settings-muted">
                    {t('projects:projectSettingsDialog.noFolderLinked')}
                  </span>
                  <Button onClick={() => void linkFolder()}>
                    {t('projects:projectSettingsDialog.linkFolder')}
                  </Button>
                </div>
              )}
            </Group>

            <Group
              title={t('projects:projectSettingsDialog.github')}
              description={t('projects:projectSettingsDialog.githubDescription')}
            >
              <ProjectGithubRepository project={current} onSaved={done} setError={setError} />
            </Group>
          </>
        )
      case 'sharing':
        return (
          <>
            <ProjectSharingPanel project={current} />
            <ProjectWebhooksPanel project={current} />
          </>
        )
      case 'backup':
        return <ProjectBackupPanel project={current} />
      case 'check':
        return <ProjectCheckPanel project={current} />
      case 'exportImport':
        return <ProjectExportImportPanel project={current} />
      case 'remove': {
        const panel = (
          <ProjectRemovePanel
            project={current}
            onArchived={() => {
              onChanged()
              onClose()
            }}
            onRestore={() => void saveEnabled(true)}
            onRemoved={(purge, backup) => setRemoved({ purge, backup })}
          />
        )
        // A demo goes with the other demo, in one click; the rest stays a click away.
        return current.demo ? (
          <DemoRemovePanel project={current} onRemoved={onClose}>
            {panel}
          </DemoRemovePanel>
        ) : (
          panel
        )
      }
      case 'agents':
        return autoRun ? (
          <AgentGroup
            project={current}
            hasFolder={folder !== null}
            autoRun={autoRun}
            saveAutoRun={(updates) => void saveAutoRun(updates)}
            onSaved={done}
            setError={setError}
            suggestedTryCommand={suggestedTryCommand}
          />
        ) : (
          <Skeleton lines={4} />
        )
    }
  }

  // Removed: the project is gone, so its settings give way to what removal did.
  if (removed)
    return (
      <ProjectRemovedDialog
        project={current}
        purge={removed.purge}
        backup={removed.backup}
        onClose={() => {
          onChanged()
          onClose()
        }}
      />
    )

  return (
    <Dialog
      open
      size="lg"
      className="ostler-project-settings-dialog"
      title={t('projects:projectSettingsDialog.settings', { currentName: current.name })}
      onClose={onClose}
      footer={
        <>
          <span className="ostler-project-settings-saved" role="status">
            {saved && (
              <>
                <Icon icon={CircleCheck} /> {t('projects:projectSettingsDialog.saved')}
              </>
            )}
          </span>
          <Button variant="primary" onClick={onClose}>
            {t('projects:projectSettingsDialog.close')}
          </Button>
        </>
      }
    >
      <div className="ostler-project-settings" ref={rootRef}>
        {error && (
          <InlineAlert
            tone="danger"
            title={t('projects:projectSettingsDialog.changeWasntSaved')}
            onDismiss={() => setError(null)}
          >
            {error}
          </InlineAlert>
        )}

        {/* One section shown at a time, every one in reach down the side. All
            sections stay mounted so switching never reloads them; only the
            shown one is visible. */}
        <Tabs
          orientation="vertical"
          label={t('projects:projectSettingsDialog.sections.label')}
          value={shown}
          onChange={(value) => {
            setSection(value)
            setVisited((seen) => (seen.has(value) ? seen : new Set([...seen, value])))
            // A long section may have scrolled the dialog body; start the new one at the top.
            rootRef.current?.closest('.ui-dialog__body')?.scrollTo?.({ top: 0 })
          }}
          items={sections.map((value) => ({
            value,
            groupStart: value === CARE_SECTIONS[0],
            label:
              value === 'agents'
                ? t('projects:projectSettingsDialog.agents')
                : t(`projects:projectSettingsDialog.sections.${value}`),
            content:
              value === shown
                ? sections.map((s) => (
                    <div key={s} className="ostler-project-settings-section" hidden={s !== shown}>
                      {isCareSection(s) && !visited.has(s) ? null : panel(s)}
                    </div>
                  ))
                : undefined
          }))}
        />
      </div>
    </Dialog>
  )
}

function Group({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Section title={title} description={description} headingLevel={3}>
      <div className="ostler-project-settings-rows">{children}</div>
    </Section>
  )
}

/** Shown only while agents are on (D10). */
function AgentGroup({
  project,
  hasFolder,
  autoRun,
  saveAutoRun,
  onSaved,
  setError,
  suggestedTryCommand
}: {
  project: RendererProject
  hasFolder: boolean
  autoRun: ProjectAutoDispatchConfig
  saveAutoRun: (updates: Partial<ProjectAutoDispatchConfig>) => void
  onSaved: (project: RendererProject) => void
  setError: (error: string | null) => void
  suggestedTryCommand?: string
}) {
  // Settings, for the model a project on "Same as Settings" uses and for
  // checking the project's own effort with its provider as Settings does.
  const { config: agentConfig } = useConfig()

  if (!hasFolder) {
    return (
      <Group title={t('projects:projectSettingsDialog.agents')}>
        <p className="ostler-project-settings-muted">
          {t('projects:projectSettingsDialog.linkFolderLetAgents')}
        </p>
      </Group>
    )
  }

  const off = !autoRun.enabled
  return (
    <>
      <Group
        title={t('projects:projectSettingsDialog.agents')}
        description={t('projects:projectSettingsDialog.howAgentsPickUp')}
      >
        <Switch
          label={t('projects:projectSettingsDialog.runQueuedTasksAutomatically')}
          hint={t('projects:projectSettingsDialog.startsBuiltAgentsQueued')}
          checked={autoRun.enabled}
          onChange={(event) => {
            const enabled = event.target.checked
            saveAutoRun({
              enabled,
              maxConcurrentEmbeddedSessions: enabled
                ? Math.max(1, autoRun.maxConcurrentEmbeddedSessions || 1)
                : 0
            })
          }}
        />
        <Switch
          label={t('projects:projectSettingsDialog.agentsPlanFirst')}
          hint={t('projects:projectSettingsDialog.agentsPlanFirstHint')}
          checked={autoRun.agentsPlanFirst === true}
          onChange={(event) => saveAutoRun({ agentsPlanFirst: event.target.checked })}
        />
        <Switch
          label={t('projects:projectSettingsDialog.reviewBeforeMe')}
          hint={t('projects:projectSettingsDialog.reviewBeforeMeHint')}
          checked={autoRun.reviewBeforeMe === true}
          onChange={(event) => saveAutoRun({ reviewBeforeMe: event.target.checked })}
        />
        <NumberField
          label={t('projects:projectSettingsDialog.agentsOnce')}
          min={1}
          max={4}
          disabled={off}
          value={Math.max(1, autoRun.maxConcurrentEmbeddedSessions || 1)}
          hint={t('projects:projectSettingsDialog.up4EachRun')}
          onChange={(value) => {
            if (value !== null && value >= 1 && value <= 4) {
              saveAutoRun({ maxConcurrentEmbeddedSessions: Math.floor(value) })
            }
          }}
        />
        {/* The project's default for the built-in agent (D42): a run that
            chose no model of its own uses this, else Settings › Agents. */}
        <Select
          label={t('projects:projectSettingsDialog.agentModel')}
          hint={t('projects:projectSettingsDialog.agentsNormallyUseModel')}
          value={autoRun.aiOverrideEnabled ? 'own' : 'same'}
          options={[
            {
              value: 'same',
              label: agentConfig
                ? t('projects:projectSettingsDialog.sameAsSettingsModel', {
                    model: resolveAgentModel(agentConfig).model
                  })
                : t('projects:projectSettingsDialog.sameAsSettings')
            },
            { value: 'own', label: t('projects:projectSettingsDialog.ownModel') }
          ]}
          onChange={(event) => saveAutoRun({ aiOverrideEnabled: event.target.value === 'own' })}
        />
        {autoRun.aiOverrideEnabled && (
          <div className="ostler-project-settings-pair">
            <Select
              label={t('projects:projectSettingsDialog.provider')}
              options={PROVIDER_OPTIONS}
              value={autoRun.defaultProvider || 'openai'}
              onChange={(event) => {
                const provider = event.target.value
                saveAutoRun({
                  defaultProvider: provider,
                  ...(DEFAULT_MODELS[provider] ? { defaultModel: DEFAULT_MODELS[provider] } : {})
                })
              }}
            />
            <ModelField
              value={autoRun.defaultModel}
              onCommit={(defaultModel) => saveAutoRun({ defaultModel, defaultEffort: '' })}
            />
          </div>
        )}
        {autoRun.aiOverrideEnabled && autoRun.defaultModel && agentConfig && (
          <EffortField
            model={autoRun.defaultModel}
            cacheKey={`${autoRun.defaultProvider || 'openai'} ${
              agentEffortConnection(
                agentConfig,
                (autoRun.defaultProvider || 'openai') as AIProvider,
                autoRun.defaultModel
              ).baseUrl ?? ''
            }`}
            draft={agentEffortConnection(
              agentConfig,
              (autoRun.defaultProvider || 'openai') as AIProvider,
              autoRun.defaultModel
            )}
            effort={autoRun.defaultEffort}
            onChange={(defaultEffort) => {
              if (defaultEffort !== autoRun.defaultEffort) saveAutoRun({ defaultEffort })
            }}
          />
        )}
      </Group>

      <ConventionsGroup project={project} onSaved={onSaved} setError={setError} />
      <ProjectLessonsGroup project={project} onSaved={onSaved} setError={setError} />

      <WorkspaceSetupGroup project={project} onSaved={onSaved} setError={setError} />
      <TryCommandGroup
        project={project}
        suggested={suggestedTryCommand}
        onSaved={onSaved}
        setError={setError}
      />
      <LimitsGroup project={project} onSaved={onSaved} setError={setError} />
    </>
  )
}

function ModelField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useSavedDraft(value)
  const commit = () => {
    const next = draft.trim()
    if (next && next !== value) onCommit(next)
  }
  return (
    <TextField
      label={t('projects:projectSettingsDialog.model')}
      value={draft}
      placeholder={t('projects:projectSettingsDialog.exampleGptO')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
      }}
    />
  )
}

type SetupMode = AgentSetupSetting['mode']

/**
 * How a new agent workspace is prepared before the agent starts (dependency
 * install). Automatic shows what it would run here, from the same resolver the
 * harness uses; Custom takes a command; Off installs nothing.
 */
function WorkspaceSetupGroup({
  project,
  onSaved,
  setError
}: {
  project: RendererProject
  onSaved: (project: RendererProject) => void
  setError: (error: string | null) => void
}) {
  const setting: AgentSetupSetting = project.agentSetup ?? { mode: 'auto' }
  const savedCommand = setting.mode === 'custom' ? setting.command : ''
  const [mode, setMode] = useSavedDraft<SetupMode>(setting.mode)
  const [draft, setDraft] = useSavedDraft(savedCommand)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [detected, setDetected] = useState<ResolvedSetup | null>(null)

  useEffect(() => {
    if (mode !== 'auto') return
    let cancelled = false
    void window.ostlerAPI.describeProjectSetup(project.id).then((result) => {
      if (!cancelled && result.ok) setDetected(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [mode, project.id, project.path])

  const save = async (next: AgentSetupSetting) => {
    const result = await window.ostlerAPI.updateProject(project.id, { agentSetup: next })
    if (!result.ok) return setError(result.error)
    setError(null)
    onSaved(result.value)
  }

  const chooseMode = (next: SetupMode) => {
    setMode(next)
    setCommandError(null)
    if (next === 'custom') return // saved once a command is entered
    void save({ mode: next })
  }

  const saveCommand = () => {
    const command = draft.trim()
    if (!command) return setCommandError(t('projects:projectSettingsDialog.setupCommandBlank'))
    setCommandError(null)
    if (command === savedCommand && setting.mode === 'custom') return
    void save({ mode: 'custom', command })
  }

  return (
    <Group
      title={t('projects:projectSettingsDialog.workspaceSetup')}
      description={t('projects:projectSettingsDialog.howWorkspacePrepared')}
    >
      <SegmentedControl
        label={t('projects:projectSettingsDialog.workspaceSetup')}
        value={mode}
        onChange={chooseMode}
        options={[
          { value: 'auto', label: t('projects:projectSettingsDialog.setupAutomatic') },
          { value: 'custom', label: t('projects:projectSettingsDialog.setupCustom') },
          { value: 'off', label: t('projects:projectSettingsDialog.setupOff') }
        ]}
      />
      {mode === 'auto' && detected?.kind === 'run' && (
        <p className="ostler-project-settings-muted">
          {t('projects:projectSettingsDialog.setupDetectedCommand', {
            command: detected.command,
            file: detected.detectedFrom
          })}
        </p>
      )}
      {mode === 'auto' && detected?.kind === 'none' && (
        <p className="ostler-project-settings-muted">
          {t('projects:projectSettingsDialog.setupNoLockfile')}
        </p>
      )}
      {mode === 'custom' && (
        <TextField
          label={t('projects:projectSettingsDialog.setupCommand')}
          value={draft}
          hint={t('projects:projectSettingsDialog.setupCommandHint')}
          error={commandError ?? undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={saveCommand}
        />
      )}
      {mode === 'off' && (
        <p className="ostler-project-settings-muted">
          {t('projects:projectSettingsDialog.setupOffHint')}
        </p>
      )}
    </Group>
  )
}

/**
 * Try it's command (N9.4): one line the person types or takes from an
 * agent's suggestion, saved only when they click Save. Empty turns Try it off.
 */
function TryCommandGroup({
  project,
  suggested,
  onSaved,
  setError
}: {
  project: RendererProject
  suggested?: string
  onSaved: (project: RendererProject) => void
  setError: (error: string | null) => void
}) {
  const saved = project.tryCommand ?? ''
  // An agent's suggestion is filled in until the person saves it or closes.
  const [draft, setDraft] = useSavedDraft(suggested ?? saved)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const changed = draft.trim() !== saved
  const tooLong = draft.trim().length > MAX_TRY_COMMAND_LENGTH

  const save = async () => {
    if (!changed || tooLong) return
    const result = await window.ostlerAPI.updateProject(project.id, { tryCommand: draft })
    if (!result.ok) return setFieldError(result.error)
    setFieldError(null)
    setError(null)
    onSaved(result.value)
  }

  return (
    <Group
      title={t('projects:tryCommand.title')}
      description={t('projects:tryCommand.description')}
    >
      <TextField
        label={t('projects:tryCommand.label')}
        value={draft}
        placeholder={t('projects:tryCommand.placeholder')}
        hint={
          suggested !== undefined && draft === suggested && changed
            ? t('projects:tryCommand.fromAgent')
            : t('projects:tryCommand.hint')
        }
        error={fieldError ?? undefined}
        maxLength={MAX_TRY_COMMAND_LENGTH}
        autoFocus={suggested !== undefined}
        onChange={(event) => setDraft(event.target.value.replace(/[\r\n]+/g, ' '))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
        }}
      />
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!changed || tooLong}
          onClick={() => void save()}
        >
          {t('projects:tryCommand.save')}
        </Button>
      </div>
    </Group>
  )
}

/**
 * Project conventions (D25): written once here, given to every coding agent
 * on this project, built-in or connected, as project context.
 */
function ConventionsGroup({
  project,
  onSaved,
  setError
}: {
  project: RendererProject
  onSaved: (project: RendererProject) => void
  setError: (error: string | null) => void
}) {
  const saved = project.agentConventions ?? ''
  const [draft, setDraft] = useSavedDraft(saved)
  const tooLong = draft.length > MAX_PROJECT_CONVENTIONS_LENGTH

  const save = async () => {
    if (draft === saved || tooLong) return
    const result = await window.ostlerAPI.updateProject(project.id, { agentConventions: draft })
    if (!result.ok) return setError(result.error)
    onSaved(result.value)
  }

  return (
    <Group
      title={t('projects:projectSettingsDialog.conventions')}
      description={t('projects:projectSettingsDialog.howWorkDoneProject')}
    >
      <TextArea
        label={t('projects:projectSettingsDialog.conventionsMarkdown')}
        className="ostler-project-settings-code"
        value={draft}
        rows={6}
        placeholder={t('projects:projectSettingsDialog.conventionsExample')}
        error={
          tooLong
            ? t('projects:projectSettingsDialog.keepConventionsUnderCharacters', {
                localeString: formatNumber(MAX_PROJECT_CONVENTIONS_LENGTH)
              })
            : undefined
        }
        hint={t('projects:projectSettingsDialog.savedWhenLeaveField')}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
      />
    </Group>
  )
}

/**
 * Token limits for the built-in agent (R5.3, D43): optional, per day and per
 * month. At a limit no new built-in run starts and a running one stops at its
 * next turn boundary with its work kept for review. Set here only; the
 * automation API can read them but not change them.
 */
function LimitsGroup({
  project,
  onSaved,
  setError
}: {
  project: RendererProject
  onSaved: (project: RendererProject) => void
  setError: (error: string | null) => void
}) {
  const saved = normalizeAgentLimits(project.agentLimits)
  const save = async (key: keyof AgentUsageLimits, value: number | null) => {
    const next = normalizeAgentLimits({ ...saved, [key]: value })
    if (next[key] === saved[key]) return
    const result = await window.ostlerAPI.updateProject(project.id, { agentLimits: next })
    if (!result.ok) return setError(result.error)
    onSaved(result.value)
  }
  return (
    <Group
      title={t('projects:projectSettingsDialog.tokenLimits')}
      description={t('projects:projectSettingsDialog.tokenLimitsDescription')}
    >
      <LimitField
        label={t('projects:projectSettingsDialog.tokensPerDay')}
        value={saved.tokensPerDay}
        onCommit={(value) => void save('tokensPerDay', value)}
      />
      <LimitField
        label={t('projects:projectSettingsDialog.tokensPerMonth')}
        value={saved.tokensPerMonth}
        onCommit={(value) => void save('tokensPerMonth', value)}
      />
    </Group>
  )
}

/** A limit saved when the field loses focus; empty is no limit. */
function LimitField({
  label,
  value,
  onCommit
}: {
  label: string
  value: number | null
  onCommit: (value: number | null) => void
}) {
  const [draft, setDraft] = useSavedDraft<number | null>(value)
  return (
    <NumberField
      label={label}
      unit={t('projects:projectSettingsDialog.tokens')}
      min={0}
      step={1000}
      value={draft}
      hint={t('projects:projectSettingsDialog.emptyNoLimit')}
      onChange={setDraft}
      onBlur={() => onCommit(draft && draft > 0 ? Math.floor(draft) : null)}
    />
  )
}
