import { useState } from 'react'
import type { PlanningRulePreview } from '@shared/ostler-api'
import { Button, InlineAlert, Select } from '../ui'
import { conditionWords, effectWords, type RuleNames } from './rule-words'
import type { RuleDraft } from './RuleEditor'
import { t } from '@shared/i18n'

/**
 * Try it on a task… (R6.2): what the rule being built would do to one task
 * of the project, worked out by the same engine that runs it, and nothing
 * written. The trigger is not checked: the task is taken as if it had just
 * happened.
 */
export function RuleTryOut({
  projectId,
  draft,
  names
}: {
  projectId: string
  draft: RuleDraft
  names: RuleNames
}) {
  const [tasks, setTasks] = useState<{ id: string; title: string }[] | null>(null)
  const [taskId, setTaskId] = useState('')
  const [preview, setPreview] = useState<PlanningRulePreview | null>(null)
  const [tried, setTried] = useState<RuleDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = async () => {
    const result = await window.ostlerAPI.getPlanningWorkItems(projectId)
    if (!result.ok) return setError(result.error)
    const list = result.value.map((item) => ({ id: item.id, title: item.title }))
    setTasks(list)
    setTaskId(list[0]?.id ?? '')
  }

  const run = async () => {
    if (!taskId) return
    const result = await window.ostlerAPI.previewPlanningRule(
      projectId,
      { conditions: draft.conditions, actions: draft.actions },
      taskId
    )
    if (!result.ok) {
      setPreview(null)
      return setError(result.error)
    }
    setError(null)
    setPreview(result.value)
    setTried(draft)
  }

  if (tasks === null)
    return (
      <div>
        <Button size="sm" variant="secondary" onClick={() => void open()}>
          {t('projects:rules.tryIt')}
        </Button>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    )

  return (
    <div className="project-rules__try">
      {tasks.length === 0 ? (
        <p className="ostler-project-settings-muted">{t('projects:rules.noTasksToTry')}</p>
      ) : (
        <div className="project-rules__line">
          <Select
            label={t('projects:rules.tryOnTask')}
            size="sm"
            value={taskId}
            options={tasks.map((task) => ({ value: task.id, label: task.title }))}
            onChange={(event) => {
              setTaskId(event.target.value)
              setPreview(null)
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => void run()}>
            {t('projects:rules.try')}
          </Button>
        </div>
      )}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {preview && tried && (
        <div className="project-rules__result" role="status">
          <p>{preview.matches ? t('projects:rules.wouldRun') : t('projects:rules.wouldNotRun')}</p>
          {tried.conditions.length > 0 && (
            <ul>
              {tried.conditions.map((condition, index) => (
                <li key={index}>
                  {preview.conditions[index]
                    ? t('projects:rules.conditionMet', {
                        condition: conditionWords(condition, names)
                      })
                    : t('projects:rules.conditionNotMet', {
                        condition: conditionWords(condition, names)
                      })}
                </li>
              ))}
            </ul>
          )}
          {preview.matches && (
            <ul>
              {preview.effects.map((effect, index) => (
                <li key={index}>{effectWords(effect, names)}</li>
              ))}
            </ul>
          )}
          <p className="ostler-project-settings-muted">{t('projects:rules.triggerNotChecked')}</p>
        </div>
      )}
    </div>
  )
}
