import { useEffect, useState } from 'react'
import type { RendererProject } from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { t } from '@shared/i18n'
import { Button, Dialog, EmptyState, InlineAlert, Select, TextField, useToast } from '../ui'
import { Bot } from '../ui/icons'
import { useFeatures } from '../navigation/features'
import { useTaskTemplates } from './useTaskTemplates'

/**
 * Why Run playbook cannot run here (N9.6b), or null: agents must be on and
 * the project must have a linked folder for an agent to work in.
 */
export function runPlaybookBlocker(
  agents: boolean,
  project: { path: string | null | undefined }
): string | null {
  if (!agents) return t('agents:playbooks.agentsOff')
  if (projectFolder(project) === null) return t('agents:playbooks.noFolder')
  return null
}

/**
 * Run playbook (N9.6b): pick a playbook (this project's and every project's),
 * optionally change the title, and Run. Main makes the task with N2.1's one
 * function and queues it for agents in the same step.
 */
export function RunPlaybookDialog({
  project,
  onClose,
  onRan
}: {
  project: RendererProject
  onClose: () => void
  onRan?: () => void
}) {
  const features = useFeatures()
  const { toast } = useToast()
  const { templates } = useTaskTemplates(project.id)
  const playbooks = templates.filter((template) => template.playbook)
  const [templateId, setTemplateId] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const chosen = playbooks.find((template) => template.id === templateId) ?? playbooks[0]
  const blocker = runPlaybookBlocker(features.agents, project)

  // The title starts as the playbook's own and follows the playbook chosen.
  useEffect(() => {
    setTitle(chosen?.body.title ?? '')
  }, [chosen?.id])

  const run = async () => {
    if (!chosen || blocker) return
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.runPlaybook(project.id, chosen.id, {
      ...(title.trim() && title.trim() !== chosen.body.title ? { title: title.trim() } : {})
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast({
      title: t('agents:playbooks.ran', { title: result.value.workItem.title }),
      body: [
        t('agents:playbooks.ranBody', { name: chosen.name }),
        result.value.modelNotOffered
          ? t('agents:playbooks.modelNotOffered', { model: result.value.modelNotOffered })
          : ''
      ]
        .filter(Boolean)
        .join(' '),
      tone: result.value.modelNotOffered ? 'warning' : 'success'
    })
    onRan?.()
    onClose()
  }

  return (
    <Dialog
      open
      title={t('agents:playbooks.runTitle')}
      description={t('agents:playbooks.runDescription')}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('agents:playbooks.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!chosen || blocker !== null}
            onClick={() => void run()}
          >
            {t('agents:playbooks.runButton')}
          </Button>
        </>
      }
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          void run()
        }}
      >
        {blocker && <InlineAlert tone="warning">{blocker}</InlineAlert>}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {playbooks.length === 0 ? (
          <EmptyState
            icon={Bot}
            title={t('agents:playbooks.none')}
            description={t('agents:playbooks.noneHint')}
          />
        ) : (
          <>
            <Select
              label={t('agents:playbooks.playbook')}
              value={chosen?.id ?? ''}
              onChange={(event) => {
                setTemplateId(event.target.value)
                setError(null)
              }}
              options={playbooks.map((template) => ({
                value: template.id,
                label:
                  template.projectId === null
                    ? `${template.name} (${t('tasks:taskTemplates.everyProject')})`
                    : template.name
              }))}
              data-autofocus
            />
            <TextField
              label={t('agents:playbooks.taskTitle')}
              hint={t('agents:playbooks.taskTitleHint')}
              value={title}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value)
                setError(null)
              }}
            />
          </>
        )}
      </form>
    </Dialog>
  )
}
