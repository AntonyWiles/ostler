import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CsvDateFormat,
  CsvDelimiter,
  CsvEncoding,
  CsvField,
  CsvImportOptions,
  CsvImportPreview,
  CsvPresetId,
  GithubImportPreview,
  GithubIssueQuery,
  ImportFileInfo,
  ImportPreviewRow,
  ImportRequest,
  ImportResult,
  ImportTarget,
  PlanningPriority,
  PlanningWorkItemStatus,
  TrelloImportOptions,
  TrelloImportPreview
} from '@shared/ostler-api'
import { CSV_FIELDS, CSV_FIELD_LABELS } from '@shared/import/csv-import'
import { CSV_PRESETS, csvPreset } from '@shared/import/csv-presets'
import {
  PLANNING_FIELD_TYPES,
  type CsvFieldTarget,
  type PlanningFieldType
} from '@shared/ostler-api'
import { fieldTypeLabel } from '@shared/planning/custom-fields'
import { TASK_PRIORITIES, taskPriorityLabel } from '@shared/task-labels'
import { useStatusWords, type StatusWords } from '../../context/ColumnsContext'
import { useOstler } from '../../context/OstlerContext'
import {
  Button,
  Checkbox,
  DataTable,
  Dialog,
  InlineAlert,
  SegmentedControl,
  Select,
  Spinner,
  TextField,
  VisuallyHidden,
  type DataTableColumn,
  type DataTableEntry
} from '../../ui'
import {
  CircleDot,
  FileInput,
  FolderOutput,
  Icon,
  TriangleAlert,
  CircleAlert
} from '../../ui/icons'
import { WizardSteps } from '../WizardSteps'
import { projectNameHint, proposeProjectName } from '../project-name-hint'
import './ImportDialog.css'
import { t } from '@shared/i18n'
import { formatList } from '@shared/format'
import { Trans } from '../../i18n/Trans'
import { projectSelectOptions } from '../areas/project-options'

/** Where the import goes: a given project, a new project, or the person chooses. */
export type ImportDialogTarget = ImportTarget | { kind: 'choose' }

type Step = 'file' | 'map' | 'preview' | 'package'

const NEW_PROJECT = '__new__'

const ENCODINGS: { value: CsvEncoding; label: string }[] = [
  {
    value: 'utf-8',
    get label() {
      return t('data:importDialog.utf8')
    }
  },
  {
    value: 'windows-1252',
    get label() {
      return t('data:importDialog.windowsExcelsDefault')
    }
  }
]
const DELIMITERS: { value: CsvDelimiter; label: string }[] = [
  {
    value: ',',
    get label() {
      return t('data:importDialog.comma')
    }
  },
  {
    value: ';',
    get label() {
      return t('data:importDialog.semicolon')
    }
  },
  {
    value: '\t',
    get label() {
      return t('data:importDialog.tab')
    }
  }
]
const DATE_FORMATS: { value: CsvDateFormat; label: string }[] = [
  {
    value: 'iso',
    get label() {
      return t('data:importDialog.yearMonthDay2026')
    }
  },
  {
    value: 'dmy',
    get label() {
      return t('data:importDialog.dayMonthYear20')
    }
  },
  {
    value: 'mdy',
    get label() {
      return t('data:importDialog.monthDayYear10')
    }
  }
]
/** The statuses a value can map to, in the destination project's words (R2.4). */
function statusOptions(words: StatusWords, mapped: PlanningWorkItemStatus) {
  return words.visible(mapped).map((status) => ({ value: status, label: words.label(status) }))
}
const PRIORITY_OPTIONS = [...TASK_PRIORITIES].reverse().map((priority) => ({
  value: priority,
  get label() {
    return taskPriorityLabel(priority)
  }
}))
/** Value mappings shown; a column with more distinct values maps the rest by guess. */
const MAX_VALUE_ROWS = 40

const STEP_LABELS: Record<Step, string> = {
  get file() {
    return t('data:importDialog.file')
  },
  get map() {
    return t('data:importDialog.mapping')
  },
  get preview() {
    return t('data:importDialog.preview')
  },
  get package() {
    return t('data:importDialog.project')
  }
}

/**
 * Import (P6.1), a guided dialog: pick a file (main reads it), map its
 * columns and values, check a preview of the first 50 rows with every
 * row's problems counted, then import in one step that can be undone.
 * CSV and Trello land in a project or a new one; an Ostler project file (or
 * an export folder from an earlier version) always becomes a new project.
 */
export function ImportDialog({
  target,
  onClose,
  onImported
}: {
  target: ImportDialogTarget
  onClose: () => void
  onImported: (result: ImportResult) => void
}) {
  const { projects } = useOstler()
  const [file, setFile] = useState<ImportFileInfo | null>(null)
  const [step, setStep] = useState<Step>('file')
  const [destination, setDestination] = useState(
    target.kind === 'project' ? target.projectId : NEW_PROJECT
  )
  const [csvOptions, setCsvOptions] = useState<CsvImportOptions>({})
  const [trelloOptions, setTrelloOptions] = useState<TrelloImportOptions>({})
  const [csvPreview, setCsvPreview] = useState<CsvImportPreview | null>(null)
  const [trelloPreview, setTrelloPreview] = useState<TrelloImportPreview | null>(null)
  // From GitHub issues (R4.4): the source is chosen before anything is read.
  const [githubMode, setGithubMode] = useState(false)
  const [githubQuery, setGithubQuery] = useState<GithubQueryDraft>({
    repository: '',
    state: 'open',
    labels: '',
    milestone: ''
  })
  const [githubPreview, setGithubPreview] = useState<GithubImportPreview | null>(null)
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [projectName, setProjectName] = useState('')
  // The name the file carries; the field proposes it free of every project's.
  const [proposedFrom, setProposedFrom] = useState<string | null>(null)
  const propose = (name: string) => {
    setProposedFrom(name)
    setProjectName(proposeProjectName(name, projects))
  }
  const nameHint = projectNameHint(projectName, projects, { proposedFrom })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A protected project file's password (N45): held only until it is tried.
  const [filePassword, setFilePassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const imported = useRef(false)
  const fileId = file?.fileId ?? null

  // Main holds the file until the import runs; closing lets it go.
  useEffect(
    () => () => {
      if (fileId && !imported.current) void window.ostlerAPI.forgetImportFile(fileId)
    },
    [fileId]
  )

  const isPackage = file?.kind === 'package'
  const intoNew = isPackage || destination === NEW_PROJECT
  const projectId = intoNew ? null : destination
  const targetProject = projects.find((project) => project.id === projectId) ?? null

  // The dry run, again whenever the mapping changes.
  useEffect(() => {
    if (!fileId || isPackage) return
    let cancelled = false
    setPreviewing(true)
    const timer = setTimeout(() => {
      void (async () => {
        const result =
          file?.kind === 'csv'
            ? await window.ostlerAPI.previewCsvImport(fileId, csvOptions, projectId)
            : file?.kind === 'github'
              ? await window.ostlerAPI.previewGithubImport(fileId, projectId)
              : await window.ostlerAPI.previewTrelloImport(fileId, trelloOptions, projectId)
        if (cancelled) return
        setPreviewing(false)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setError(null)
        if (file?.kind === 'csv') setCsvPreview(result.value as CsvImportPreview)
        else if (file?.kind === 'github') setGithubPreview(result.value as GithubImportPreview)
        else setTrelloPreview(result.value as TrelloImportPreview)
      })()
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [fileId, file?.kind, isPackage, csvOptions, trelloOptions, projectId])

  const choose = async (mode: 'file' | 'folder') => {
    setError(null)
    const result = await window.ostlerAPI.pickImportFile(mode)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (!result.value) return
    if (fileId) void window.ostlerAPI.forgetImportFile(fileId)
    setGithubMode(false)
    setGithubPreview(null)
    setFile(result.value)
    setFilePassword('')
    setCsvOptions({})
    setTrelloOptions({})
    setCsvPreview(null)
    setTrelloPreview(null)
    propose(result.value.packageSummary?.name ?? result.value.fileName.replace(/\.[^.]+$/, ''))
  }

  // Decrypted and checked in main; a wrong password keeps the file held to try again.
  const unlock = async () => {
    if (!file?.locked) return
    setUnlocking(true)
    setError(null)
    const result = await window.ostlerAPI.unlockImportFile(file.fileId, filePassword)
    setUnlocking(false)
    setFilePassword('')
    if (!result.ok) return setError(result.error)
    setFile(result.value)
    propose(result.value.packageSummary?.name ?? result.value.fileName.replace(/\.[^.]+$/, ''))
    setStep('package')
  }

  const chooseGithub = () => {
    setError(null)
    if (fileId) void window.ostlerAPI.forgetImportFile(fileId)
    setFile(null)
    setGithubPreview(null)
    setGithubMode(true)
    const repository = targetProject?.githubRepository ?? ''
    setGithubQuery((current) => ({ ...current, repository: current.repository || repository }))
  }

  // The person asked for these issues: the one request to GitHub this dialog makes.
  const loadIssues = async () => {
    setLoadingIssues(true)
    setError(null)
    const query: GithubIssueQuery = {
      repository: githubQuery.repository,
      state: githubQuery.state,
      labels: githubQuery.labels
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean),
      milestone: githubQuery.milestone.trim()
    }
    const result = await window.ostlerAPI.loadGithubIssues(query)
    setLoadingIssues(false)
    if (!result.ok) return setError(result.error)
    if (fileId) void window.ostlerAPI.forgetImportFile(fileId)
    setGithubPreview(null)
    setFile(result.value)
    propose(result.value.fileName.split('/').pop() ?? result.value.fileName)
    setStep('preview')
  }

  const preview: CsvImportPreview | TrelloImportPreview | GithubImportPreview | null =
    file?.kind === 'csv'
      ? csvPreview
      : file?.kind === 'trello'
        ? trelloPreview
        : file?.kind === 'github'
          ? githubPreview
          : null
  useEffect(() => {
    if (file?.kind === 'trello' && trelloPreview) propose(trelloPreview.boardName)
  }, [file?.kind, trelloPreview?.boardName])

  const steps: Step[] = isPackage ? ['file', 'package'] : ['file', 'map', 'preview']
  const stepIndex = steps.indexOf(step)
  const isLast = stepIndex === steps.length - 1
  const ready =
    step === 'file'
      ? file?.locked
        ? filePassword !== '' && !unlocking
        : file !== null || githubMode
      : step === 'map' && githubMode
        ? githubQuery.repository.trim() !== '' && !loadingIssues
        : step === 'map'
          ? preview !== null
          : step === 'preview'
            ? preview !== null && preview.importableCount > 0 && !previewing
            : true

  const run = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    const request: ImportRequest =
      file.kind === 'csv'
        ? { kind: 'csv', options: csvOptions }
        : file.kind === 'trello'
          ? { kind: 'trello', options: trelloOptions }
          : file.kind === 'github'
            ? { kind: 'github' }
            : { kind: 'package' }
    const importTarget: ImportTarget = intoNew
      ? { kind: 'new', name: projectName.trim() || undefined }
      : { kind: 'project', projectId: destination }
    const result = await window.ostlerAPI.runImport(file.fileId, request, importTarget)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    imported.current = true
    onImported(result.value)
  }

  const next = () => {
    setError(null)
    if (isLast) void run()
    else if (step === 'file' && file?.locked) void unlock()
    else if (step === 'map' && githubMode) void loadIssues()
    else setStep(steps[stepIndex + 1])
  }

  const footer = (
    <>
      <Button onClick={onClose} disabled={busy}>
        {t('data:importDialog.cancel')}
      </Button>
      {stepIndex > 0 && (
        <Button disabled={busy} onClick={() => setStep(steps[stepIndex - 1])}>
          {t('data:importDialog.back')}
        </Button>
      )}
      <Button
        variant="primary"
        loading={busy || loadingIssues || unlocking}
        disabled={busy || !ready}
        onClick={next}
      >
        {isLast
          ? preview
            ? t('data:importDialog.importTasks', { count: preview.importableCount })
            : t('data:importDialog.importProject')
          : step === 'map' && githubMode
            ? t('data:importDialog.readIssues')
            : t('data:importDialog.next')}
      </Button>
    </>
  )

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={
        targetProject && !isPackage
          ? t('data:importDialog.importTasksInto', { targetProjectName: targetProject.name })
          : t('data:importDialog.import')
      }
      description={t('data:importDialog.step', {
        number: stepIndex + 1,
        stepCount: steps.length,
        title: STEP_LABELS[step]
      })}
      footer={footer}
      className="import-dialog"
    >
      <div className="import-dialog__body">
        <WizardSteps steps={steps.map((id) => STEP_LABELS[id])} current={stepIndex} />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}

        {step === 'file' && (
          <FileStep
            file={file}
            target={target}
            destination={destination}
            onDestination={setDestination}
            onChoose={(mode) => void choose(mode)}
            github={githubMode}
            onGithub={chooseGithub}
          />
        )}
        {step === 'file' && file?.locked && (
          <div className="import-dialog__unlock">
            <InlineAlert tone="info">{t('data:importDialog.protectedFile')}</InlineAlert>
            <TextField
              label={t('data:importDialog.filePassword')}
              type="password"
              autoComplete="off"
              value={filePassword}
              onChange={(event) => setFilePassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && filePassword !== '') void unlock()
              }}
              data-autofocus
            />
          </div>
        )}

        {step === 'map' && !githubMode && file?.kind === 'csv' && (
          <CsvMapping
            projectId={projectId}
            preview={csvPreview}
            options={csvOptions}
            onChange={(patch) => setCsvOptions((current) => ({ ...current, ...patch }))}
          />
        )}
        {step === 'map' && githubMode && (
          <GithubIssuesStep
            query={githubQuery}
            onChange={(patch) => setGithubQuery((current) => ({ ...current, ...patch }))}
          />
        )}
        {step === 'map' && !githubMode && file?.kind === 'trello' && (
          <TrelloMapping
            projectId={projectId}
            preview={trelloPreview}
            options={trelloOptions}
            onChange={(patch) => setTrelloOptions((current) => ({ ...current, ...patch }))}
          />
        )}

        {step === 'preview' && (
          <>
            {intoNew && (
              <TextField
                label={t('data:importDialog.projectName')}
                value={projectName}
                maxLength={80}
                hint={nameHint}
                onChange={(event) => setProjectName(event.target.value)}
              />
            )}
            {preview ? (
              <PreviewStep preview={preview} kind={file?.kind ?? 'csv'} loading={previewing} />
            ) : (
              <Spinner label={t('data:importDialog.checkingFile')} />
            )}
          </>
        )}

        {step === 'package' && file?.packageSummary && (
          <>
            <p>
              {t(
                file.packageSummary.isTemplate
                  ? 'data:importDialog.templateBecomesNewProject'
                  : 'data:importDialog.becomesNewProjectEverything',
                {
                  packageSummaryName: file.packageSummary.name,
                  milestoneCount: file.packageSummary.milestoneCount,
                  taskCount: file.packageSummary.taskCount,
                  libraryFileCount: file.packageSummary.fileCount
                }
              )}
            </p>
            <TextField
              label={t('data:importDialog.projectName')}
              value={projectName}
              maxLength={80}
              hint={nameHint}
              onChange={(event) => setProjectName(event.target.value)}
            />
          </>
        )}
      </div>
    </Dialog>
  )
}

function FileStep({
  file,
  target,
  destination,
  onDestination,
  onChoose,
  github,
  onGithub
}: {
  file: ImportFileInfo | null
  target: ImportDialogTarget
  destination: string
  onDestination: (value: string) => void
  onChoose: (mode: 'file' | 'folder') => void
  github: boolean
  onGithub: () => void
}) {
  const { projects, areas } = useOstler()
  return (
    <>
      <p>{t('data:importDialog.bringSpreadsheetSavedCsv')}</p>
      <div className="import-dialog__choose">
        <Button icon={FileInput} onClick={() => onChoose('file')} data-autofocus>
          {t('data:importDialog.chooseFile')}
        </Button>
        <Button icon={CircleDot} onClick={onGithub}>
          {t('data:importDialog.fromGithubIssues')}
        </Button>
      </div>
      <p className="import-dialog__older">
        <Button size="sm" icon={FolderOutput} variant="ghost" onClick={() => onChoose('folder')}>
          {t('data:importDialog.chooseEarlierExportFolder')}
        </Button>
      </p>
      {github && !file && (
        <p className="import-dialog__file" aria-live="polite">
          <strong>{t('data:importDialog.githubIssues')}</strong>
          {' · '}
          {t('data:importDialog.githubIssuesNext')}
        </p>
      )}
      {file && (
        <p className="import-dialog__file" aria-live="polite">
          <strong>{file.fileName}</strong>
          {' · '}
          {file.kind === 'csv'
            ? t('data:importDialog.spreadsheetCsv')
            : file.kind === 'trello'
              ? t('data:importDialog.trelloBoard')
              : file.kind === 'github'
                ? t('data:importDialog.githubIssues')
                : t('data:importDialog.project2')}
        </p>
      )}
      {file?.kind === 'package' && target.kind === 'project' && (
        <InlineAlert tone="info">{t('data:importDialog.projectFileBecomesNew')}</InlineAlert>
      )}
      {target.kind === 'choose' && file?.kind !== 'package' && (
        <Select
          label={t('data:importDialog.importInto')}
          value={destination}
          onChange={(event) => onDestination(event.target.value)}
          options={[
            { value: NEW_PROJECT, label: t('data:importDialog.newProject') },
            ...projectSelectOptions(
              projects.filter((project) => project.enabled),
              areas
            )
          ]}
        />
      )}
    </>
  )
}

/** What the person typed for From GitHub issues, before it is read. */
interface GithubQueryDraft {
  repository: string
  state: 'open' | 'all'
  /** Comma separated. */
  labels: string
  milestone: string
}

/**
 * From GitHub issues (R4.4): which repository and which issues. Nothing is
 * sent to GitHub until the person presses Read issues.
 */
function GithubIssuesStep({
  query,
  onChange
}: {
  query: GithubQueryDraft
  onChange: (patch: Partial<GithubQueryDraft>) => void
}) {
  return (
    <>
      <p>{t('data:importDialog.githubIntro')}</p>
      <TextField
        label={t('data:importDialog.githubRepository')}
        placeholder={t('data:importDialog.githubRepositoryPlaceholder')}
        value={query.repository}
        maxLength={300}
        data-autofocus
        onChange={(event) => onChange({ repository: event.target.value })}
      />
      <SegmentedControl
        label={t('data:importDialog.githubWhich')}
        value={query.state}
        onChange={(state) => onChange({ state })}
        options={[
          { value: 'open', label: t('data:importDialog.githubOpen') },
          { value: 'all', label: t('data:importDialog.githubAll') }
        ]}
      />
      <TextField
        label={t('data:importDialog.githubLabels')}
        hint={t('data:importDialog.githubLabelsHint')}
        value={query.labels}
        maxLength={500}
        onChange={(event) => onChange({ labels: event.target.value })}
      />
      <TextField
        label={t('data:importDialog.githubMilestone')}
        hint={t('data:importDialog.githubMilestoneHint')}
        value={query.milestone}
        maxLength={200}
        onChange={(event) => onChange({ milestone: event.target.value })}
      />
      <p className="import-dialog__hint">{t('data:importDialog.githubPrivacy')}</p>
    </>
  )
}

/** A custom-field target as a Select value: `id:<field>`, `new:<type>`, or '' for none. */
function fieldTargetValue(target: CsvFieldTarget | null): string {
  if (!target) return ''
  return 'fieldId' in target ? `id:${target.fieldId}` : `new:${target.create.type}`
}

function fieldTargetFrom(value: string, header: string): CsvFieldTarget | null {
  if (value.startsWith('id:')) return { fieldId: value.slice(3) }
  if (value.startsWith('new:'))
    return { create: { name: header, type: value.slice(4) as PlanningFieldType } }
  return null
}

function CsvMapping({
  projectId,
  preview,
  options,
  onChange
}: {
  projectId: string | null
  preview: CsvImportPreview | null
  options: CsvImportOptions
  onChange: (patch: Partial<CsvImportOptions>) => void
}) {
  const words = useStatusWords(projectId ?? '')
  if (!preview) return <Spinner label={t('data:importDialog.readingFile')} />
  const columnOptions = [
    { value: '', label: t('data:importDialog.notImported') },
    ...preview.headers.map((header, index) => ({ value: String(index), label: header }))
  ]
  const setColumn = (field: CsvField, value: string) =>
    onChange({ columns: { ...preview.columns, [field]: value === '' ? null : Number(value) } })
  const setStatus = (value: string, status: PlanningWorkItemStatus) =>
    onChange({
      statusMap: {
        ...Object.fromEntries(preview.statuses.map((entry) => [entry.value, entry.mapped])),
        ...options.statusMap,
        [value]: status
      }
    })
  const setPriority = (value: string, priority: PlanningPriority) =>
    onChange({
      priorityMap: {
        ...Object.fromEntries(preview.priorities.map((entry) => [entry.value, entry.mapped])),
        ...options.priorityMap,
        [value]: priority
      }
    })
  const detected = csvPreset(preview.detectedPreset)
  const inUse = csvPreset(preview.preset)
  // Another tool's mapping starts again from that tool's own.
  const choosePreset = (value: string) =>
    onChange({
      preset: value as CsvPresetId | 'none',
      columns: undefined,
      statusMap: undefined,
      priorityMap: undefined,
      dateFormat: undefined,
      fieldColumns: undefined
    })
  return (
    <>
      {inUse && (
        <InlineAlert tone="info">
          {t(
            inUse === detected
              ? 'data:importDialog.looksLikeExport'
              : 'data:importDialog.readAsExport',
            { tool: inUse.name }
          )}
        </InlineAlert>
      )}
      <fieldset className="import-dialog__group">
        <legend>{t('data:importDialog.file')}</legend>
        <div className="import-dialog__grid">
          <Select
            label={t('data:importDialog.exportedFrom')}
            size="sm"
            value={preview.preset ?? 'none'}
            options={[
              ...CSV_PRESETS.map((preset) => ({ value: preset.id, label: preset.name })),
              { value: 'none', label: t('data:importDialog.mapColumnsMyself') }
            ]}
            onChange={(event) => choosePreset(event.target.value)}
          />
          <Select
            label={t('data:importDialog.encoding')}
            size="sm"
            value={preview.encoding}
            options={ENCODINGS}
            onChange={(event) => onChange({ encoding: event.target.value as CsvEncoding })}
          />
          <Select
            label={t('data:importDialog.separator')}
            size="sm"
            value={preview.delimiter}
            options={DELIMITERS}
            onChange={(event) => onChange({ delimiter: event.target.value as CsvDelimiter })}
          />
          <Select
            label={t('data:importDialog.datesWritten')}
            size="sm"
            value={preview.dateFormat}
            options={DATE_FORMATS}
            onChange={(event) => onChange({ dateFormat: event.target.value as CsvDateFormat })}
          />
        </div>
      </fieldset>
      <fieldset className="import-dialog__group">
        <legend>{t('data:importDialog.columns')}</legend>
        <p className="import-dialog__hint">{t('data:importDialog.whichColumnHoldsEach')}</p>
        <div className="import-dialog__grid">
          {CSV_FIELDS.filter(
            // Iteration only where it can mean something (R6.1).
            (field) =>
              field !== 'iteration' ||
              preview.columns.iteration !== null ||
              (preview.iterationCount ?? 0) > 0
          ).map((field) => (
            <Select
              key={field}
              label={
                field === 'title'
                  ? t('data:importDialog.required', { field: CSV_FIELD_LABELS[field] })
                  : CSV_FIELD_LABELS[field]
              }
              size="sm"
              value={preview.columns[field] == null ? '' : String(preview.columns[field])}
              options={columnOptions}
              onChange={(event) => setColumn(field, event.target.value)}
            />
          ))}
        </div>
      </fieldset>
      {preview.customColumns.length > 0 && (
        <fieldset className="import-dialog__group">
          <legend>{t('data:importDialog.customFields')}</legend>
          <p className="import-dialog__hint">{t('data:importDialog.customFieldsHint')}</p>
          <div className="import-dialog__grid">
            {preview.customColumns.map((entry) => (
              <Select
                key={entry.column}
                label={entry.header}
                size="sm"
                value={fieldTargetValue(entry.target)}
                options={[
                  { value: '', label: t('data:importDialog.notImported') },
                  ...preview.existingFields.map((field) => ({
                    value: `id:${field.id}`,
                    label: field.name
                  })),
                  ...PLANNING_FIELD_TYPES.map((type) => ({
                    value: `new:${type}`,
                    label:
                      type === entry.suggestedType
                        ? t('data:importDialog.newFieldSuggested', { type: fieldTypeLabel(type) })
                        : t('data:importDialog.newField', { type: fieldTypeLabel(type) })
                  }))
                ]}
                onChange={(event) =>
                  onChange({
                    fieldColumns: {
                      ...Object.fromEntries(
                        preview.customColumns.map((column) => [
                          String(column.column),
                          column.target
                        ])
                      ),
                      ...options.fieldColumns,
                      [String(entry.column)]: fieldTargetFrom(event.target.value, entry.header)
                    }
                  })
                }
              />
            ))}
          </div>
          {preview.newFields.length > 0 && (
            <p className="import-dialog__hint">
              {t('data:importDialog.newFieldsCreated', { names: formatList(preview.newFields) })}
            </p>
          )}
        </fieldset>
      )}
      {(preview.statuses.length > 0 || preview.priorities.length > 0) && (
        <fieldset className="import-dialog__group">
          <legend>{t('data:importDialog.values')}</legend>
          <p className="import-dialog__hint">{t('data:importDialog.whatEachStatusPriority')}</p>
          <div className="import-dialog__grid">
            {preview.statuses.slice(0, MAX_VALUE_ROWS).map((entry) => (
              <Select
                key={`status:${entry.value}`}
                label={t('data:importDialog.status', {
                  entryValue: entry.value,
                  entryCount: entry.count
                })}
                size="sm"
                value={entry.mapped}
                options={statusOptions(words, entry.mapped)}
                onChange={(event) =>
                  setStatus(entry.value, event.target.value as PlanningWorkItemStatus)
                }
              />
            ))}
            {preview.priorities.slice(0, MAX_VALUE_ROWS).map((entry) => (
              <Select
                key={`priority:${entry.value}`}
                label={t('data:importDialog.priority', {
                  entryValue: entry.value,
                  entryCount: entry.count
                })}
                size="sm"
                value={entry.mapped}
                options={PRIORITY_OPTIONS}
                onChange={(event) =>
                  setPriority(entry.value, event.target.value as PlanningPriority)
                }
              />
            ))}
          </div>
        </fieldset>
      )}
    </>
  )
}

function TrelloMapping({
  projectId,
  preview,
  options,
  onChange
}: {
  projectId: string | null
  preview: TrelloImportPreview | null
  options: TrelloImportOptions
  onChange: (patch: Partial<TrelloImportOptions>) => void
}) {
  const words = useStatusWords(projectId ?? '')
  if (!preview) return <Spinner label={t('data:importDialog.readingBoard')} />
  return (
    <>
      <p>
        {t('data:importDialog.membersBecomePeopleLabels', {
          boardName: preview.boardName,
          listCount: preview.lists.length,
          labelCount: preview.labelCount,
          memberCount: preview.memberCount
        })}
      </p>
      <fieldset className="import-dialog__group">
        <legend>{t('data:importDialog.lists')}</legend>
        <p className="import-dialog__hint">{t('data:importDialog.statusEachListsCards')}</p>
        <div className="import-dialog__grid">
          {preview.lists.map((list) => (
            <Select
              key={list.id}
              label={
                list.archived
                  ? t('data:importDialog.archived', {
                      listName: list.name,
                      cardCount: list.cardCount
                    })
                  : t('data:importDialog.listWithCount', {
                      listName: list.name,
                      cardCount: list.cardCount
                    })
              }
              size="sm"
              value={list.mapped}
              options={statusOptions(words, list.mapped)}
              onChange={(event) =>
                onChange({
                  listMap: {
                    ...Object.fromEntries(preview.lists.map((entry) => [entry.id, entry.mapped])),
                    ...options.listMap,
                    [list.id]: event.target.value as PlanningWorkItemStatus
                  }
                })
              }
            />
          ))}
        </div>
      </fieldset>
      <Checkbox
        label={t('data:importDialog.includeArchivedCards', {
          archivedCardCount: preview.archivedCardCount
        })}
        checked={options.includeArchived === true}
        disabled={preview.archivedCardCount === 0}
        onChange={(event) => onChange({ includeArchived: event.target.checked })}
      />
    </>
  )
}

/** Problems as words: "1 error, 2 warnings". */
function problemCount(row: ImportPreviewRow): string {
  return [
    row.errors.length > 0 ? t('data:importDialog.errorCount', { count: row.errors.length }) : '',
    row.warnings.length > 0
      ? t('data:importDialog.warningCount', { count: row.warnings.length })
      : ''
  ]
    .filter(Boolean)
    .join(', ')
}

function PreviewStep({
  preview,
  kind,
  loading
}: {
  preview: CsvImportPreview | TrelloImportPreview | GithubImportPreview
  kind: ImportFileInfo['kind']
  loading: boolean
}) {
  const fields: CsvField[] = useMemo(() => {
    if ('columns' in preview)
      return CSV_FIELDS.filter((field) => field !== 'title' && preview.columns[field] != null)
    if ('repository' in preview) return ['status', 'labels', 'assignee', 'milestone']
    return ['status', 'labels', 'assignee', 'due', 'checklist']
  }, [preview])
  const unit = kind === 'csv' ? 'row' : kind === 'github' ? 'issue' : 'card'

  const columns: DataTableColumn<ImportPreviewRow>[] = [
    {
      id: 'line',
      header:
        unit === 'row'
          ? t('data:importDialog.row')
          : unit === 'issue'
            ? t('data:importDialog.issue')
            : t('data:importDialog.card'),
      width: 64,
      align: 'end',
      cell: (row) => (
        <span className="tabular-nums">{unit === 'issue' ? `#${row.line}` : row.line}</span>
      )
    },
    {
      id: 'title',
      header: t('data:importDialog.title'),
      width: 240,
      cell: (row) => <PreviewCell row={row} field="title" text={row.title} />
    },
    ...fields.map((field): DataTableColumn<ImportPreviewRow> => ({
      id: field,
      header:
        kind === 'trello' && field === 'status'
          ? t('data:importDialog.list')
          : CSV_FIELD_LABELS[field],
      width: field === 'description' ? 220 : 130,
      cell: (row) => <PreviewCell row={row} field={field} text={row.cells[field] ?? ''} />
    })),
    {
      id: 'problems',
      header: t('data:importDialog.problems'),
      width: 260,
      cell: (row) =>
        row.errors.length + row.warnings.length === 0 ? null : (
          <span
            className={
              row.errors.length > 0 ? 'import-dialog__problem is-error' : 'import-dialog__problem'
            }
            title={[...row.errors, ...row.warnings].map((issue) => issue.message).join('\n')}
          >
            {t('data:importDialog.problemSummary', {
              problems: problemCount(row),
              message: [...row.errors, ...row.warnings][0].message
            })}
          </span>
        )
    }
  ]
  const entries: DataTableEntry<ImportPreviewRow>[] = preview.rows.map((row) => ({
    kind: 'row',
    id: String(row.line),
    row,
    label: t(
      unit === 'row'
        ? 'data:importDialog.rowLabel'
        : unit === 'issue'
          ? 'data:importDialog.issueLabel'
          : 'data:importDialog.cardLabel',
      {
        line: row.line,
        title: row.title || t('data:importDialog.noTitle'),
        context: row.errors.length + row.warnings.length > 0 ? 'problems' : undefined,
        problems: problemCount(row)
      }
    )
  }))

  return (
    <>
      <div className="import-dialog__summary" aria-live="polite" aria-busy={loading}>
        <p>
          <Trans
            i18nKey="data:importDialog.willBeImported"
            count={preview.importableCount}
            values={{ count: preview.importableCount }}
            components={{ strong: <strong /> }}
          />
          {preview.errorRowCount > 0 && ' '}
          {preview.errorRowCount > 0 &&
            t(
              kind === 'csv'
                ? 'data:importDialog.rowsWithErrorsSkipped'
                : 'data:importDialog.cardsWithErrorsSkipped',
              { count: preview.errorRowCount }
            )}
          {preview.warningCount > 0 && ' '}
          {preview.warningCount > 0 &&
            t('data:importDialog.warningsShortened', {
              warnings: t('data:importDialog.warningCount', { count: preview.warningCount }),
              rows: t(
                unit === 'row'
                  ? 'data:importDialog.rowCount'
                  : unit === 'issue'
                    ? 'data:importDialog.issueCount'
                    : 'data:importDialog.cardCount',
                {
                  count: preview.warningRowCount
                }
              )
            })}
        </p>
        {'repository' in preview && (
          <p className="import-dialog__hint">
            {[
              t('data:importDialog.githubRead', {
                count: preview.issueCount,
                repository: preview.repository
              }),
              preview.alreadyLinkedCount > 0
                ? t('data:importDialog.githubAlreadyLinked', {
                    count: preview.alreadyLinkedCount
                  })
                : '',
              preview.truncated ? t('data:importDialog.githubTruncated') : '',
              t('data:importDialog.githubLinked')
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
        )}
        {'subtaskCount' in preview && (preview.subtaskCount > 0 || preview.dependencyCount > 0) && (
          <p className="import-dialog__hint">
            {t('data:importDialog.structureSummary', {
              parts: formatList(
                [
                  preview.subtaskCount > 0
                    ? t('data:importDialog.subtaskCount', { count: preview.subtaskCount })
                    : '',
                  preview.dependencyCount > 0
                    ? t('data:importDialog.waitsOnCount', { count: preview.dependencyCount })
                    : ''
                ].filter(Boolean)
              )
            })}
          </p>
        )}
        {(preview.newMilestones.length > 0 ||
          preview.newPeople.length > 0 ||
          (preview.newTypes?.length ?? 0) > 0) && (
          <p className="import-dialog__hint">
            {[
              preview.newMilestones.length > 0
                ? t('data:importDialog.newMilestones', {
                    milestones: formatList(preview.newMilestones)
                  })
                : '',
              preview.newPeople.length > 0
                ? t('data:importDialog.newPeople', { people: formatList(preview.newPeople) })
                : '',
              preview.newTypes && preview.newTypes.length > 0
                ? t('data:importDialog.newTypes', { types: formatList(preview.newTypes) })
                : ''
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
        )}
        <p className="import-dialog__hint">
          {preview.rowCount > preview.rows.length
            ? t('data:importDialog.firstShownNothingWritten', {
                shown: preview.rows.length,
                total: preview.rowCount
              })
            : t('data:importDialog.nothingWrittenUntilImport')}
        </p>
      </div>
      <DataTable
        label={t('data:importDialog.importPreview')}
        className="import-dialog__table"
        columns={columns}
        entries={entries}
      />
    </>
  )
}

/** A preview cell, marked when that value has a problem. */
function PreviewCell({
  row,
  field,
  text
}: {
  row: ImportPreviewRow
  field: CsvField
  text: string
}) {
  const error = row.errors.find((issue) => issue.field === field)
  const warning = row.warnings.find((issue) => issue.field === field)
  const issue = error ?? warning
  if (!issue) return <span className="import-dialog__cell">{text}</span>
  return (
    <span
      className={`import-dialog__cell import-dialog__cell--${error ? 'error' : 'warning'}`}
      title={issue.message}
    >
      <Icon icon={error ? CircleAlert : TriangleAlert} />
      <span>{text || t('data:importDialog.empty')}</span>
      <VisuallyHidden>
        {error
          ? t('data:importDialog.error', { message: issue.message })
          : t('data:importDialog.warning', { message: issue.message })}
      </VisuallyHidden>
    </span>
  )
}
