import { useCallback, useEffect, useState } from 'react'
import { MAX_RULES_PER_PROJECT, type PlanningRule } from '@shared/ostler-api'
import { usePeople } from '../context/PeopleContext'
import { Button, IconButton, Switch, useToast } from '../ui'
import { Pencil, Plus, Trash2 } from '../ui/icons'
import { EMPTY_RULE_NAMES, ruleSentence, type RuleNames } from './rule-words'
import { RuleEditor, newRuleDraft, type RuleDraft } from './RuleEditor'
import '../components/ProjectLabelsManager.css'
import './rules.css'
import { t } from '@shared/i18n'

/**
 * A project's rules (R6.2, D45), in Project settings › Rules: each one's
 * sentence with its on and off switch, New rule, Edit and Delete with undo.
 * Everything goes through the planning service's one engine; nothing here
 * decides what a rule does.
 */
export function ProjectRulesManager({
  projectId,
  onError,
  onSaved
}: {
  projectId: string
  onError: (error: string | null) => void
  onSaved: () => void
}) {
  const { toastUndo } = useToast()
  const people = usePeople()
  const [rules, setRules] = useState<PlanningRule[] | null>(null)
  const [records, setRecords] = useState<Omit<RuleNames, 'people'>>(EMPTY_RULE_NAMES)
  /** The rule being edited, `'new'` for New rule, or null. */
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getPlanningRules(projectId)
    if (result.ok) setRules(result.value)
    else onError(result.error)
  }, [projectId, onError])

  useEffect(() => {
    void load()
    void Promise.all([
      window.ostlerAPI.getPlanningMilestones(projectId),
      window.ostlerAPI.getPlanningLabels(projectId),
      window.ostlerAPI.getPlanningFields(projectId),
      window.ostlerAPI.getPlanningColumnSettings()
    ]).then(([milestones, labels, fields, columns]) =>
      setRecords({
        milestones: milestones.ok
          ? milestones.value.map((milestone) => ({ id: milestone.id, name: milestone.name }))
          : [],
        labels: labels.ok ? labels.value.map((label) => label.name) : [],
        fields: fields.ok ? fields.value : [],
        columns: columns.ok ? (columns.value[projectId] ?? null) : null
      })
    )
  }, [load, projectId])

  const names: RuleNames = {
    ...records,
    people: people.offered(projectId).map((person) => ({ id: person.id, name: person.name }))
  }

  const saved = async () => {
    onError(null)
    setEditing(null)
    await load()
    onSaved()
  }

  const create = async (draft: RuleDraft) => {
    const result = await window.ostlerAPI.createPlanningRule(projectId, draft)
    if (!result.ok) return onError(result.error)
    await saved()
  }

  const update = async (rule: PlanningRule, draft: RuleDraft) => {
    const result = await window.ostlerAPI.updatePlanningRule(rule.id, draft)
    if (!result.ok) return onError(result.error)
    await saved()
  }

  const toggle = async (rule: PlanningRule, enabled: boolean) => {
    const result = await window.ostlerAPI.updatePlanningRule(rule.id, { enabled })
    if (!result.ok) return onError(result.error)
    setRules((list) => list?.map((entry) => (entry.id === rule.id ? result.value : entry)) ?? null)
    onSaved()
  }

  const remove = async (rule: PlanningRule) => {
    const result = await window.ostlerAPI.deletePlanningRule(rule.id)
    if (!result.ok) return onError(result.error)
    await load()
    onSaved()
    const deletion = result.value
    toastUndo(t('projects:rules.deleted', { name: rule.name }), async () => {
      const restored = await window.ostlerAPI.restorePlanningRule(deletion)
      if (!restored.ok) return onError(restored.error)
      await load()
      onSaved()
    })
  }

  if (rules === null) return null
  const atLimit = rules.length >= MAX_RULES_PER_PROJECT

  return (
    <div className="project-rules">
      {rules.length === 0 ? (
        <p className="ostler-project-settings-muted">{t('projects:rules.noRulesYet')}</p>
      ) : (
        <ul className="project-labels" aria-label={t('projects:rules.title')}>
          {rules.map((rule) =>
            editing === rule.id ? (
              <li key={rule.id} className="project-labels__row is-editing">
                <RuleEditor
                  projectId={projectId}
                  initial={{
                    name: rule.name,
                    trigger: rule.trigger,
                    conditions: rule.conditions,
                    actions: rule.actions
                  }}
                  names={names}
                  onCancel={() => setEditing(null)}
                  onSave={(draft) => update(rule, draft)}
                />
              </li>
            ) : (
              <li key={rule.id} className="project-labels__row project-rules__row">
                <Switch
                  className="project-rules__switch"
                  label={rule.name}
                  hint={ruleSentence(rule, names)}
                  checked={rule.enabled}
                  onChange={(event) => void toggle(rule, event.target.checked)}
                />
                <span className="project-labels__count">
                  {rule.runCount === 0
                    ? t('projects:rules.notRunYet')
                    : t('projects:rules.ran', { count: rule.runCount })}
                </span>
                <IconButton
                  size="sm"
                  icon={Pencil}
                  label={t('projects:rules.editRule', { name: rule.name })}
                  onClick={() => setEditing(rule.id)}
                />
                <IconButton
                  size="sm"
                  icon={Trash2}
                  label={t('projects:rules.deleteRule', { name: rule.name })}
                  onClick={() => void remove(rule)}
                />
              </li>
            )
          )}
        </ul>
      )}
      {editing === 'new' ? (
        <div className="project-rules__new">
          <RuleEditor
            projectId={projectId}
            initial={newRuleDraft()}
            names={names}
            onCancel={() => setEditing(null)}
            onSave={create}
          />
        </div>
      ) : (
        <div>
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            disabled={atLimit}
            onClick={() => setEditing('new')}
          >
            {t('projects:rules.newRule')}
          </Button>
          {atLimit && (
            <p className="ostler-project-settings-muted">
              {t('projects:rules.atLimit', { max: MAX_RULES_PER_PROJECT })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
