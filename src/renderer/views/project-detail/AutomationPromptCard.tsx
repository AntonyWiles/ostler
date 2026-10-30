import { useConfig } from '../../hooks/useConfig'
import { useState } from 'react'
import { RendererProject } from '@shared/ostler-api'
import { isHarnessPort } from '@shared/harness-url'
import { Button, Card, InlineAlert, Section, TextArea } from '../../ui'
import { Copy } from '../../ui/icons'
import '../planning/planning-dialogs.css'
import { t } from '@shared/i18n'

export function AutomationPromptCard({ project }: { project: RendererProject }) {
  const automationPort = useConfig().config?.automationApi.port ?? null
  const [task, setTask] = useState('')
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canGenerate = project.hasAutomationToken && isHarnessPort(automationPort) && task.trim()

  const markCopied = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card as="section">
      <Section
        title={t('agents:automationPromptCard.agentTaskPrompt')}
        headingLevel={2}
        description={
          project.hasAutomationToken
            ? t('agents:automationPromptCard.describeWhatWantExternal')
            : undefined
        }
      >
        {!project.hasAutomationToken ? (
          <p className="dialog-muted">
            {t('agents:automationPromptCard.generateAutomationTokenProject')}
          </p>
        ) : (
          <div className="dialog-form">
            <TextArea
              label={t('agents:automationPromptCard.whatShouldAiDo')}
              rows={3}
              placeholder={t('agents:automationPromptCard.eGCreateNew')}
              value={task}
              onChange={(e) => {
                setTask(e.target.value)
                setGeneratedPrompt('')
              }}
            />
            <div>
              <Button
                variant="secondary"
                icon={Copy}
                disabled={!canGenerate}
                onClick={async () => {
                  if (!isHarnessPort(automationPort)) {
                    setError(t('agents:automationPromptCard.automationApiPortUnavailable'))
                    return
                  }
                  setError(null)
                  // Main builds the prompt (it holds the token) and copies it.
                  const r = await window.ostlerAPI.copyAutomationTaskPrompt(project.id, task)
                  if (!r.ok) {
                    setError(r.error)
                    return
                  }
                  setGeneratedPrompt(r.value)
                  markCopied()
                }}
              >
                {t('agents:automationPromptCard.generateCopy')}
              </Button>
            </div>
            {error && <InlineAlert tone="danger">{error}</InlineAlert>}
            {generatedPrompt && (
              <>
                <TextArea
                  label={t('agents:automationPromptCard.promptPreviewTokenHidden')}
                  rows={12}
                  readOnly
                  value={generatedPrompt}
                />
                <div>
                  <Button
                    variant="secondary"
                    icon={Copy}
                    onClick={async () => {
                      const r = await window.ostlerAPI.copyAutomationTaskPrompt(project.id, task)
                      if (!r.ok) setError(r.error)
                      else markCopied()
                    }}
                  >
                    {copied
                      ? t('agents:automationPromptCard.copied')
                      : t('agents:automationPromptCard.copyPrompt')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Section>
    </Card>
  )
}
