import { useState } from 'react'
import { MAX_TASK_TEMPLATE_NAME_LENGTH, type PlanningWorkItem } from '@shared/ostler-api'
import { sameTemplateName } from '@shared/task-templates'
import {
  Button,
  Checkbox,
  Dialog,
  InlineAlert,
  Radio,
  RadioGroup,
  TextField,
  useConfirm,
  useToast
} from '../ui'
import { useTaskTemplates } from './useTaskTemplates'
import { EMPTY_PLAYBOOK_AGENT, PlaybookAgentFields } from './PlaybookAgentFields'
import { usePlaybookModelSettings } from './usePlaybookModelSettings'
import { t } from '@shared/i18n'

/**
 * "Save as task template…" (N2.1), from the task drawer's menu: a name (the
 * title by default), This project or Every project, and whether to keep the
 * dates. Its subtasks come too; comments, activity, attachments and
 * dependencies never do. Saving over a name already used asks first.
 * With `playbook`, "Save as playbook…" (N9.6b): the same, saved as a
 * playbook with a model, plan first and extra instructions for the agent.
 */
export function SaveTaskTemplateDialog({
  item,
  onClose,
  playbook = false
}: {
  item: PlanningWorkItem
  onClose: () => void
  playbook?: boolean
}) {
  const { toast } = useToast()
  const confirm = useConfirm()
  const { templates } = useTaskTemplates(item.projectId)
  const [name, setName] = useState(item.title.slice(0, MAX_TASK_TEMPLATE_NAME_LENGTH))
  const [scope, setScope] = useState<'project' | 'every'>('project')
  const [keepDates, setKeepDates] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hasDates = item.startDate !== null || item.targetDate !== null
  const [agent, setAgent] = useState(EMPTY_PLAYBOOK_AGENT)
  const modelSettings = usePlaybookModelSettings(scope === 'every' ? null : item.projectId)

  const save = async () => {
    if (!name.trim()) {
      setError(t('tasks:taskTemplates.enterName'))
      return
    }
    const clash = templates.some(
      (template) =>
        (template.projectId === null) === (scope === 'every') &&
        sameTemplateName(template.name, name)
    )
    if (
      clash &&
      !(await confirm({
        title: t('tasks:taskTemplates.replaceTitle', { name: name.trim() }),
        body: t('tasks:taskTemplates.replaceBody'),
        confirmLabel: t('tasks:taskTemplates.replace')
      }))
    )
      return
    setBusy(true)
    const result = await window.ostlerAPI.saveTaskTemplateFromWorkItem(item.id, {
      name,
      scope,
      keepDates: hasDates && keepDates,
      replace: clash,
      ...(playbook ? { agent } : {})
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast({
      title: playbook
        ? t('agents:playbooks.saved', { name: result.value.name })
        : t('tasks:taskTemplates.saved', { name: result.value.name }),
      body: playbook ? t('agents:playbooks.savedBody') : t('tasks:taskTemplates.savedBody'),
      tone: 'success'
    })
    onClose()
  }

  return (
    <Dialog
      open
      title={playbook ? t('agents:playbooks.saveTitle') : t('tasks:taskTemplates.saveTitle')}
      description={
        playbook ? t('agents:playbooks.saveDescription') : t('tasks:taskTemplates.saveDescription')
      }
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('tasks:taskTemplates.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {playbook ? t('agents:playbooks.savePlaybook') : t('tasks:taskTemplates.saveTemplate')}
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
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('tasks:taskTemplates.name')}
          value={name}
          maxLength={MAX_TASK_TEMPLATE_NAME_LENGTH}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          data-autofocus
        />
        <RadioGroup legend={t('tasks:taskTemplates.useIn')}>
          <Radio
            name="task-template-scope"
            label={t('tasks:taskTemplates.thisProject')}
            checked={scope === 'project'}
            onChange={() => setScope('project')}
          />
          <Radio
            name="task-template-scope"
            label={t('tasks:taskTemplates.everyProject')}
            hint={t('tasks:taskTemplates.everyProjectHint')}
            checked={scope === 'every'}
            onChange={() => setScope('every')}
          />
        </RadioGroup>
        <Checkbox
          label={t('tasks:taskTemplates.keepDates')}
          hint={
            hasDates ? t('tasks:taskTemplates.keepDatesHint') : t('tasks:taskTemplates.noDates')
          }
          checked={hasDates && keepDates}
          disabled={!hasDates}
          onChange={(event) => setKeepDates(event.target.checked)}
        />
        {playbook && (
          <PlaybookAgentFields settings={modelSettings} value={agent} onChange={setAgent} />
        )}
      </form>
    </Dialog>
  )
}
