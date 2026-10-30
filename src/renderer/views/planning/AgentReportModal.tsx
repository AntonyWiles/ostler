import { HarnessTask } from '@shared/ostler-api'
import { Button, Dialog, InlineAlert } from '../../ui'
import './planning-dialogs.css'
import { t } from '@shared/i18n'
import { formatRelativeTime } from '@shared/format'

interface AgentReportModalProps {
  task: HarnessTask
  onClose: () => void
}

/**
 * Shows the completion report for a finished task, including Ostler-observed
 * tool and file evidence for embedded sessions.
 */
export function AgentReportModal({ task, onClose }: AgentReportModalProps) {
  const report = task.report
  if (!report) return null

  const source = report.missing
    ? t('agents:agentReportModal.builtAgentSentNo')
    : report.inconsistent
      ? t('agents:agentReportModal.agentsReportDoesntMatch')
      : report.toolsRun
        ? t('agents:agentReportModal.reportBuiltAgent')
        : t('agents:agentReportModal.agentsOwnReportNot')

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={task.title}
      description={source}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('agents:agentReportModal.close')}
        </Button>
      }
    >
      <div className="dialog-form">
        <p className="dialog-muted">
          {t('agents:agentReportModal.sentAgentFinishedTask', {
            when: formatRelativeTime(new Date(report.submittedAt).getTime())
          })}
        </p>

        {report.inconsistent && (
          <InlineAlert tone="danger">
            {report.inconsistentReason ?? t('agents:agentReportModal.reportDoesntMatchWhat')}
          </InlineAlert>
        )}

        {report.missing ? (
          <InlineAlert tone="warning">{report.summary}</InlineAlert>
        ) : (
          <p className="dialog-report">{report.summary}</p>
        )}

        {report.filesChangedSource === 'ostler' && (
          <InlineAlert tone="info">{t('agents:agentReportModal.agentNamedNoFiles')}</InlineAlert>
        )}

        {report.toolsRun && (
          <section className="dialog-section">
            <h3 className="dialog-section__title">{t('agents:agentReportModal.toolsRun')}</h3>
            {report.toolsRun.length ? (
              <ul className="dialog-list dialog-list--code">
                {report.toolsRun.map((tool) => (
                  <li key={tool}>
                    <code>{tool}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dialog-muted">{t('agents:agentReportModal.noToolCallsWere')}</p>
            )}
          </section>
        )}

        <section className="dialog-section">
          <h3 className="dialog-section__title">{t('agents:agentReportModal.filesChanged')}</h3>
          {report.filesChanged.length > 0 ? (
            <ul className="dialog-list dialog-list--code">
              {report.filesChanged.map((path) => (
                <li key={path}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dialog-muted">{t('agents:agentReportModal.noChangedFilesWere')}</p>
          )}
        </section>
      </div>
    </Dialog>
  )
}
