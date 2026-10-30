import { useRef } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { useWritingHelp, WritingHelpLayout } from '../../components/WritingHelp'
import { useItemLinkPicker } from '../../hooks/useItemLinkPicker'
import { useStatusWords } from '../../context/ColumnsContext'
import { Checkbox, DateField, TextArea, TextField } from '../../ui'
import './planning-dialogs.css'
import { t } from '@shared/i18n'

/** A decision record as its form edits it. */
export interface DecisionDraftFields {
  title: string
  date: string
  context: string
  decision: string
  alternativesConsidered: string
  consequences: string
  linkedWorkItemIds: string[]
}

/**
 * The fields of a decision record, shared by the create, edit and AI draft
 * dialogs so the three read the same.
 */
export function DecisionFields({
  value,
  onChange,
  workItems,
  disabled,
  writingHelp,
  projectId = null
}: {
  /** The decision's project: typing `[[` in its text links to its items (N4.4a). */
  projectId?: string | null
  value: DecisionDraftFields
  onChange: (patch: Partial<DecisionDraftFields>) => void
  workItems: PlanningWorkItem[]
  disabled?: boolean
  /** Offers Improve writing on the text fields of a saved decision (N8.2). */
  writingHelp?: WritingHelpTarget
}) {
  const statusWords = useStatusWords()
  return (
    <>
      <TextField
        label={t('tasks:decisionFields.title')}
        data-autofocus
        value={value.title}
        onChange={(event) => onChange({ title: event.target.value })}
        placeholder={t('tasks:decisionFields.exampleUseSqliteLocal')}
        disabled={disabled}
        required
      />
      <DateField
        label={t('tasks:decisionFields.date')}
        value={value.date}
        due={false}
        onChange={(date) => onChange({ date })}
        disabled={disabled}
      />
      <DecisionText
        label={t('tasks:decisionFields.context')}
        hint={t('tasks:decisionFields.problemBackgroundCalledDecision')}
        value={value.context}
        onText={(text) => onChange({ context: text })}
        disabled={disabled}
        writingHelp={writingHelp}
        projectId={projectId}
      />
      <DecisionText
        label={t('tasks:decisionFields.decision')}
        hint={t('tasks:decisionFields.whatWasChosen')}
        value={value.decision}
        onText={(text) => onChange({ decision: text })}
        disabled={disabled}
        required
        writingHelp={writingHelp}
        projectId={projectId}
      />
      <DecisionText
        label={t('tasks:decisionFields.alternatives')}
        hint={t('tasks:decisionFields.otherOptionsWeighed')}
        value={value.alternativesConsidered}
        onText={(text) => onChange({ alternativesConsidered: text })}
        disabled={disabled}
        writingHelp={writingHelp}
        projectId={projectId}
      />
      <DecisionText
        label={t('tasks:decisionFields.consequences')}
        hint={t('tasks:decisionFields.whatFollowsBenefitsTrade')}
        value={value.consequences}
        onText={(text) => onChange({ consequences: text })}
        disabled={disabled}
        writingHelp={writingHelp}
        projectId={projectId}
      />
      {workItems.length > 0 && (
        <fieldset className="dialog-checklist__fieldset">
          <legend>{t('tasks:decisionFields.linkedTasks')}</legend>
          <ul className="dialog-checklist">
            {workItems.map((item) => (
              <li key={item.id}>
                <Checkbox
                  label={item.title}
                  hint={statusWords.label(item.status)}
                  checked={value.linkedWorkItemIds.includes(item.id)}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      linkedWorkItemIds: event.target.checked
                        ? [...value.linkedWorkItemIds, item.id]
                        : value.linkedWorkItemIds.filter((id) => id !== item.id)
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </>
  )
}

interface WritingHelpTarget {
  projectId: string
  decisionId: string
}

/** One of a decision's text fields, with Improve writing when `writingHelp` is given. */
function DecisionText({
  label,
  hint,
  value,
  onText,
  disabled,
  required,
  writingHelp,
  projectId
}: {
  projectId: string | null
  label: string
  hint: string
  value: string
  onText: (text: string) => void
  disabled?: boolean
  required?: boolean
  writingHelp?: WritingHelpTarget
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  const help = useWritingHelp({
    projectId: writingHelp?.projectId ?? '',
    target: { kind: 'decision', decisionId: writingHelp?.decisionId ?? '' },
    value,
    onChange: onText,
    textRef,
    fieldLabel: label,
    hidden: !writingHelp || disabled
  })
  const links = useItemLinkPicker({
    projectId: disabled ? null : projectId,
    value,
    onChange: onText,
    textRef
  })
  return (
    <div className="decision-text">
      {help.button && <div className="decision-text__actions">{help.button}</div>}
      <WritingHelpLayout suggestion={help.suggestion}>
        <TextArea
          ref={textRef}
          label={label}
          hint={hint}
          rows={3}
          value={value}
          onChange={(event) => onText(event.target.value)}
          disabled={disabled}
          required={required}
          {...links.inputProps}
        />
        {links.picker}
      </WritingHelpLayout>
    </div>
  )
}
