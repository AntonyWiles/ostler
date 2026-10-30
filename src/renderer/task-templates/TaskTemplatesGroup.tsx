import { useCallback, useEffect, useState } from 'react'
import { MAX_TASK_TEMPLATE_NAME_LENGTH, type TaskTemplate } from '@shared/ostler-api'
import { formatDate } from '@shared/format'
import { useOstler } from '../context/OstlerContext'
import { Button, Checkbox, Dialog, EmptyState, Select, TextField, useToast } from '../ui'
import { useFeatures } from '../navigation/features'
import { EMPTY_PLAYBOOK_AGENT, PlaybookAgentFields } from './PlaybookAgentFields'
import { usePlaybookModelSettings } from './usePlaybookModelSettings'
import { LayoutTemplate } from '../ui/icons'
import { SettingsGroup } from '../views/settings/settings-form'
import { t } from '@shared/i18n'
import { projectSelectOptions } from '../components/areas/project-options'

const EVERY = ''

/**
 * Settings › Projects › Task templates (N2.1): every task template, with its
 * scope and when it last changed; rename, change scope, and delete (at once,
 * with undo). Saving one is in a task's menu. Playbooks (N9.6b) are listed
 * apart, while agents are on; Edit changes a playbook's agent part, and makes
 * any template a playbook or stops it being one.
 */
export function TaskTemplatesGroup() {
  const { projects } = useOstler()
  const features = useFeatures()
  const { toast, toastUndo } = useToast()
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [editing, setEditing] = useState<TaskTemplate | null>(null)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getAllTaskTemplates()
    if (result.ok) setTemplates(result.value)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const scopeName = (template: TaskTemplate) =>
    template.projectId === null
      ? t('tasks:taskTemplates.everyProject')
      : (projects.find((project) => project.id === template.projectId)?.name ?? '')

  const remove = async (template: TaskTemplate) => {
    const result = await window.ostlerAPI.deleteTaskTemplate(template.id)
    if (!result.ok) {
      toast({
        title: t('settings:taskTemplatesGroup.couldntDelete', { name: template.name }),
        body: result.error,
        tone: 'danger'
      })
      return
    }
    await load()
    toastUndo(t('settings:taskTemplatesGroup.deleted', { name: template.name }), async () => {
      await window.ostlerAPI.restoreTaskTemplate(result.value)
      await load()
    })
  }

  const playbooks = templates.filter((template) => template.playbook)
  const ordinary = templates.filter((template) => !template.playbook)
  const list = (shown: TaskTemplate[], label: string) => (
    <ul className="ostler-settings-project-list" aria-label={label}>
      {shown.map((template) => (
        <li key={template.id} className="ostler-settings-project">
          <div className="ostler-settings-project-text">
            <span className="ostler-settings-project-name">{template.name}</span>
            <span className="ostler-settings-project-folder">
              {t('settings:taskTemplatesGroup.meta', {
                scope: scopeName(template),
                date: formatDate(template.updatedAt)
              })}
            </span>
          </div>
          <div className="ostler-settings-project-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(template)}
              aria-label={t('settings:taskTemplatesGroup.editLabel', { name: template.name })}
            >
              {t('settings:taskTemplatesGroup.edit')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void remove(template)}
              aria-label={t('settings:taskTemplatesGroup.deleteLabel', {
                name: template.name
              })}
            >
              {t('settings:taskTemplatesGroup.delete')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )

  return (
    <SettingsGroup id="task-templates" description={t('settings:taskTemplatesGroup.description')}>
      {templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title={t('settings:taskTemplatesGroup.none')}
          description={t('settings:taskTemplatesGroup.noneHint')}
        />
      ) : features.agents ? (
        <>
          <h3 className="dialog-section__title">{t('settings:taskTemplatesGroup.playbooks')}</h3>
          <p className="ostler-settings-project-folder">
            {t('settings:taskTemplatesGroup.playbooksDescription')}
          </p>
          {playbooks.length === 0 ? (
            <p className="ostler-settings-project-folder">{t('agents:playbooks.noneHint')}</p>
          ) : (
            list(playbooks, t('settings:taskTemplatesGroup.playbooks'))
          )}
          {ordinary.length > 0 && (
            <>
              <h3 className="dialog-section__title">
                {t('settings:taskTemplatesGroup.templates')}
              </h3>
              {list(ordinary, t('settings:taskTemplatesGroup.title'))}
            </>
          )}
        </>
      ) : (
        list(templates, t('settings:taskTemplatesGroup.title'))
      )}
      {editing && (
        <EditTaskTemplateDialog
          template={editing}
          agents={features.agents}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
    </SettingsGroup>
  )
}

/**
 * Rename a task template, or change where it can be used. While agents are
 * on, make it a playbook or stop it being one, and edit a playbook's agent
 * part (N9.6b); a template that stops being one keeps its agent part.
 */
function EditTaskTemplateDialog({
  template,
  agents,
  onClose,
  onSaved
}: {
  template: TaskTemplate
  agents: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { projects, areas } = useOstler()
  const [name, setName] = useState(template.name)
  const [scope, setScope] = useState(template.projectId ?? EVERY)
  const [playbook, setPlaybook] = useState(template.playbook)
  const [agent, setAgent] = useState(template.body.agent ?? EMPTY_PLAYBOOK_AGENT)
  const [error, setError] = useState<string | null>(null)
  const modelSettings = usePlaybookModelSettings(scope === EVERY ? null : scope)

  const save = async () => {
    const result = await window.ostlerAPI.updateTaskTemplate(template.id, {
      name,
      projectId: scope === EVERY ? null : scope,
      ...(agents ? { playbook, ...(playbook ? { body: { ...template.body, agent } } : {}) } : {})
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('settings:taskTemplatesGroup.editLabel', { name: template.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('settings:taskTemplatesGroup.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            {t('settings:taskTemplatesGroup.save')}
          </Button>
        </>
      }
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextField
          label={t('tasks:taskTemplates.name')}
          value={name}
          maxLength={MAX_TASK_TEMPLATE_NAME_LENGTH}
          error={error ?? undefined}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          data-autofocus
        />
        <Select
          label={t('tasks:taskTemplates.useIn')}
          value={scope}
          onChange={(event) => {
            setScope(event.target.value)
            setError(null)
          }}
          options={[
            { value: EVERY, label: t('tasks:taskTemplates.everyProject') },
            ...projectSelectOptions(projects, areas)
          ]}
        />
        {agents && (
          <Checkbox
            label={t('settings:taskTemplatesGroup.isPlaybook')}
            hint={t('settings:taskTemplatesGroup.isPlaybookHint')}
            checked={playbook}
            onChange={(event) => {
              setPlaybook(event.target.checked)
              setError(null)
            }}
          />
        )}
        {agents && playbook && (
          <PlaybookAgentFields settings={modelSettings} value={agent} onChange={setAgent} />
        )}
      </form>
    </Dialog>
  )
}
