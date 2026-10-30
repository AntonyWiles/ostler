import { useState } from 'react'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { Badge, Button, Card, InlineAlert, TextField } from '../../ui'
import { t } from '@shared/i18n'
import { Trans } from '../../i18n/Trans'

/**
 * Pending agent questions, answerable in place. These used to live only in the
 * project Agents tab, so Planning could report that an agent was waiting but
 * not let you unblock it without navigating away.
 */
export function AgentQuestionsPanel({ ws }: { ws: PlanningWorkspace }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const questions = ws.pendingQuestions
  if (questions.length === 0) return null

  const answer = async (questionId: string) => {
    const text = (drafts[questionId] || '').trim()
    if (!text) return
    setBusyId(questionId)
    setError(null)
    const result = await window.ostlerAPI.answerHarnessQuestion(ws.projectId, questionId, text)
    if (result.ok) {
      setDrafts((prev) => ({ ...prev, [questionId]: '' }))
      await ws.loadPlanning()
    } else {
      setError(result.error)
    }
    setBusyId(null)
  }

  return (
    <Card
      as="section"
      aria-label={t('agents:agentQuestionsPanel.agentQuestions')}
      className="overview-panel"
    >
      <h3 className="overview-panel__title">
        {t('agents:agentQuestionsPanel.agentQuestions')} <Badge>{questions.length}</Badge>
      </h3>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <ul className="overview-panel__list">
        {questions.map((question) => (
          <li key={question.id} className="overview-question">
            <p>
              <Trans
                i18nKey="agents:agentQuestionsPanel.sessionAsked"
                values={{ session: question.sessionTitle, question: question.question }}
                components={{ strong: <strong /> }}
              />
            </p>
            <form
              className="overview-question__form"
              onSubmit={(event) => {
                event.preventDefault()
                void answer(question.id)
              }}
            >
              <TextField
                label={t('agents:agentQuestionsPanel.answer', {
                  sessionTitle: question.sessionTitle
                })}
                hideLabel
                className="overview-question__field"
                value={drafts[question.id] || ''}
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, [question.id]: event.target.value }))
                }
                placeholder={t('agents:agentQuestionsPanel.answer2')}
              />
              <Button
                type="submit"
                variant="primary"
                loading={busyId === question.id}
                disabled={!(drafts[question.id] || '').trim()}
                disabledReason={t('agents:agentQuestionsPanel.writeAnswerFirst')}
              >
                {t('agents:agentQuestionsPanel.answer3')}
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </Card>
  )
}
