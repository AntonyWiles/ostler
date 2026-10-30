import { useState } from 'react'
import type { HarnessTaskRejection } from '@shared/ostler-api'
import type { AgentRunChoice } from '@shared/agent-model'
import { Button, Radio, RadioGroup, TextArea } from '../../ui'
import { useAgentModelSettings } from '../../hooks/planning/useAgentModelSettings'
import { RunModelPicker } from './RunModelPicker'
import './RejectWorkForm.css'
import { t } from '@shared/i18n'

/** Where rejected work goes; the words are `agents:rejectWorkForm.<value>.label` and `.hint`. */
const DISPOSITIONS: HarnessTaskRejection['disposition'][] = ['retry', 'rework', 'hold']

/**
 * Rejecting an agent's work, wherever review happens.
 *
 * Review used to have two exits and neither carried a verdict: accept took the
 * work, discard threw the branch away silently and the task went back to the
 * queue with no record of what was wrong -- so the next agent repeated it. This
 * asks for the two things only a human can supply: why, and what should happen
 * to the task now. Ostler routes it accordingly and never decides that itself.
 *
 * Sending it back to the queue also chooses the next run's model (D42): opened
 * as "Run again with…" (`runAgain`), that is the only way the form offers.
 */
export function RejectWorkForm({
  projectId,
  busy,
  runAgain = false,
  initialChoice = { model: '', effort: '' },
  commentCount = 0,
  reason: givenReason,
  onReasonChange,
  onReject
}: {
  projectId: string
  busy: boolean
  /** Opened from "Run again with…": back in the queue, with a model to choose. */
  runAgain?: boolean
  /** The model the task had for its last run. */
  initialChoice?: AgentRunChoice
  /** Draft line comments Send back carries (N9.2a); with any, the reason may be empty. */
  commentCount?: number
  /**
   * The reason, when the caller keeps it: Review changes does, so Send back as
   * mine on a general finding can add the finding's words to it. Left out, the
   * form keeps its own.
   */
  reason?: string
  onReasonChange?: (reason: string) => void
  onReject: (
    reason: string,
    disposition: HarnessTaskRejection['disposition'],
    runAgainWith?: AgentRunChoice
  ) => void
}) {
  const [ownReason, setOwnReason] = useState('')
  const reason = givenReason ?? ownReason
  const setReason = onReasonChange ?? setOwnReason
  const [disposition, setDisposition] = useState<HarnessTaskRejection['disposition']>('retry')
  const [choice, setChoice] = useState<AgentRunChoice>(initialChoice)
  const settings = useAgentModelSettings(projectId)

  const missing = reason.trim().length === 0 && commentCount === 0
  return (
    <div className="reject-work-form">
      {commentCount > 0 && (
        <p className="reject-work-form__comments" role="status">
          {t('agents:lineComments.willBeSent', { count: commentCount })}
        </p>
      )}
      <TextArea
        label={t('agents:rejectWorkForm.whyBeingRejected')}
        hint={
          commentCount > 0
            ? `${t('agents:rejectWorkForm.sayWhatWrongWork')} ${t('agents:lineComments.reasonOptional')}`
            : t('agents:rejectWorkForm.sayWhatWrongWork')
        }
        rows={3}
        autoFocus
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {!runAgain && (
        <RadioGroup legend={t('agents:rejectWorkForm.thenWhatHappensTask')}>
          {DISPOSITIONS.map((value) => (
            <Radio
              key={value}
              name="reject-disposition"
              label={t(`agents:rejectWorkForm.disposition.${value}.label`)}
              hint={t(`agents:rejectWorkForm.disposition.${value}.hint`)}
              checked={disposition === value}
              onChange={() => setDisposition(value)}
            />
          ))}
        </RadioGroup>
      )}
      {disposition === 'retry' && settings && (
        <RunModelPicker
          settings={settings}
          label={t('agents:runModel.runAgainModel')}
          value={choice}
          onChange={setChoice}
        />
      )}
      <div className="reject-work-form__actions">
        <Button
          size="sm"
          variant="danger"
          disabled={busy || missing}
          disabledReason={missing ? t('agents:rejectWorkForm.reasonRequiredWholePoint') : undefined}
          title={t('agents:rejectWorkForm.discardsChangesRecordsReason')}
          onClick={() =>
            onReject(reason, disposition, disposition === 'retry' && settings ? choice : undefined)
          }
        >
          {runAgain
            ? t('agents:runModel.runAgain')
            : t('agents:rejectWorkForm.rejectDiscardChanges')}
        </Button>
      </div>
    </div>
  )
}
