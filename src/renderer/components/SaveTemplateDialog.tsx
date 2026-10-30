import { useState } from 'react'
import type { ProjectPackageInclude, RendererProject } from '@shared/ostler-api'
import { Button, Checkbox, Dialog, InlineAlert, TextArea, TextField, useToast } from '../ui'
import './SaveTemplateDialog.css'
import { t } from '@shared/i18n'

const INCLUDE_CHOICES: { key: keyof ProjectPackageInclude; label: string; hint?: string }[] = [
  {
    key: 'tasks',
    get label() {
      return t('projects:saveTemplateDialog.tasks')
    },
    get hint() {
      return t('projects:saveTemplateDialog.subtasksChecklistsDependenciesRepeats')
    }
  },
  {
    key: 'milestones',
    get label() {
      return t('projects:saveTemplateDialog.goalsMilestones')
    }
  },
  {
    key: 'labels',
    get label() {
      return t('projects:saveTemplateDialog.labelsTheirColours')
    }
  },
  {
    key: 'people',
    get label() {
      return t('projects:saveTemplateDialog.whoTasksAssigned')
    },
    get hint() {
      return t('projects:saveTemplateDialog.matchedNameWhenUsed')
    }
  },
  {
    key: 'decisions',
    get label() {
      return t('projects:saveTemplateDialog.decisions')
    }
  },
  {
    key: 'library',
    get label() {
      return t('projects:saveTemplateDialog.libraryBriefsGuidesNotes')
    },
    get hint() {
      return t('projects:saveTemplateDialog.neverFiles')
    }
  },
  {
    key: 'taskTemplates',
    get label() {
      return t('projects:saveTemplateDialog.taskTemplates')
    },
    get hint() {
      return t('projects:saveTemplateDialog.projectsOwnTaskTemplates')
    }
  }
]

/**
 * "Save as template…" (P5.8): what to include and whether dates become
 * relative. Comments, activity, agent links and completed state never travel;
 * the template is saved in the data folder's `templates` folder.
 */
export function SaveTemplateDialog({
  project,
  onClose
}: {
  project: RendererProject
  onClose: () => void
}) {
  const { toast } = useToast()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState('')
  const [include, setInclude] = useState<Required<Omit<ProjectPackageInclude, 'comments'>>>({
    tasks: true,
    milestones: true,
    labels: true,
    people: false,
    decisions: true,
    library: true,
    taskTemplates: true
  })
  const [relativeDates, setRelativeDates] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) {
      setError(t('projects:saveTemplateDialog.enterName'))
      return
    }
    setBusy(true)
    const result = await window.ostlerAPI.saveProjectAsTemplate(project.id, {
      name,
      description,
      include,
      relativeDates
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast({
      title: t('projects:saveTemplateDialog.savedTemplate', { valueName: result.value.name }),
      body: t('projects:saveTemplateDialog.startNewProjectNew'),
      tone: 'success'
    })
    onClose()
  }

  return (
    <Dialog
      open
      title={t('projects:saveTemplateDialog.saveTemplate', { projectName: project.name })}
      description={t('projects:saveTemplateDialog.commentsActivityAgentLinks')}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('projects:saveTemplateDialog.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t('projects:saveTemplateDialog.saveTemplate2')}
          </Button>
        </>
      }
    >
      <form
        className="ostler-save-template"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('projects:saveTemplateDialog.templateName')}
          value={name}
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          data-autofocus
        />
        <TextArea
          label={t('projects:saveTemplateDialog.description')}
          hint={t('projects:saveTemplateDialog.optionalOneLineShown')}
          value={description}
          maxLength={200}
          rows={2}
          onChange={(event) => setDescription(event.target.value)}
        />
        <fieldset className="ui-radio-group ui-radio-group--vertical">
          <legend className="ui-radio-group__legend">
            {t('projects:saveTemplateDialog.include')}
          </legend>
          {INCLUDE_CHOICES.map((choice) => (
            <Checkbox
              key={choice.key}
              label={choice.label}
              hint={choice.hint}
              checked={include[choice.key as keyof typeof include]}
              onChange={(event) =>
                setInclude((current) => ({ ...current, [choice.key]: event.target.checked }))
              }
            />
          ))}
        </fieldset>
        <Checkbox
          label={t('projects:saveTemplateDialog.makeDatesRelative')}
          hint={t('projects:saveTemplateDialog.dueDatesBecomeDays')}
          checked={relativeDates}
          onChange={(event) => setRelativeDates(event.target.checked)}
        />
      </form>
    </Dialog>
  )
}
