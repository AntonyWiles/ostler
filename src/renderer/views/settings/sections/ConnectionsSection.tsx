import { useEffect, useState } from 'react'
import type { McpClientForm, McpConnection, RendererProject } from '@shared/ostler-api'
import { isHarnessPort } from '@shared/harness-url'
import { useOstler } from '../../../context/OstlerContext'
import { Button, InlineAlert, Select, Switch, TextArea, useConfirm, useToast } from '../../../ui'
import { Copy } from '../../../ui/icons'
import { CommittedNumberField, SettingsGroup, useSettings } from '../settings-form'
import { TokenControls } from '../TokenControls'
import { GithubTokenGroup } from '../../../github/GithubTokenGroup'
import { AccountsGroup } from '../../../accounts/AccountsGroup'
import { SyncServerGroup } from '../../../accounts/SyncServerGroup'
import { EmailSettingsGroup } from '../../../email/EmailSettingsGroup'
import { t } from '@shared/i18n'
import { projectSelectOptions } from '../../../components/areas/project-options'

/**
 * Settings › Connections (D38): the automation API's own switch, apart from
 * AI agents, and for each project its token and how to connect an AI
 * assistant over MCP (D39). Text that carries a token is built and copied in
 * main; the renderer shows it masked. Below them, the optional GitHub token (R4.4).
 * Connected accounts come first (integrations phase 0), then the sync server
 * projects can be shared through (phase 7), and the email server invites
 * are emailed through (MOP-4).
 */
export function ConnectionsSection() {
  const { config, saveConfig } = useSettings()
  const automation = config.automationApi
  return (
    <>
      <AccountsGroup />
      <SyncServerGroup />
      <EmailSettingsGroup />
      <SettingsGroup
        id="automation-api"
        description={t('settings:connectionsSection.letsAssistantPlan')}
      >
        <Switch
          label={t('settings:connectionsSection.turnOn')}
          checked={automation.enabled}
          onChange={(event) =>
            void saveConfig({ automationApi: { enabled: event.target.checked } })
          }
          aria-describedby="ostler-connections-explainer"
        />
        <p id="ostler-connections-explainer" className="ostler-settings-hint">
          {automation.enabled
            ? t('settings:connectionsSection.listensThisComputer')
            : t('settings:connectionsSection.whileOff')}
        </p>
        {automation.enabled && (
          <CommittedNumberField
            label={t('settings:connectionsSection.port')}
            min={1024}
            max={65535}
            value={automation.port}
            hint={t('settings:connectionsSection.changingPort')}
            onCommit={(port) => void saveConfig({ automationApi: { port } })}
          />
        )}
      </SettingsGroup>
      {automation.enabled && <ProjectConnections port={automation.port} />}
      <GithubTokenGroup />
    </>
  )
}

function ProjectConnections({ port }: { port: number }) {
  const { projects, areas } = useOstler()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const project = projects.find((candidate) => candidate.id === projectId) ?? projects[0]
  if (!project) return null
  return (
    <SettingsGroup
      id="automation-projects"
      description={t('settings:connectionsSection.eachProjectToken')}
    >
      <Select
        label={t('settings:connectionsSection.project')}
        value={project.id}
        options={projectSelectOptions(projects, areas)}
        onChange={(event) => setProjectId(event.target.value)}
      />
      <ProjectConnection key={project.id} project={project} port={port} />
    </SettingsGroup>
  )
}

function ProjectConnection({ project: initial, port }: { project: RendererProject; port: number }) {
  const { refreshProjects } = useOstler()
  const { markSaved } = useSettings()
  const confirm = useConfirm()
  const { toastUndo } = useToast()
  const [project, setProject] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = project.id

  const replaceProject = (updated: RendererProject) => {
    setProject(updated)
    void refreshProjects()
    markSaved()
  }

  const act = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ostler-settings-subsections">
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      <section className="ostler-settings-subsection" aria-labelledby={`automation-${id}`}>
        <h4 id={`automation-${id}`}>{t('agents:agentsSection.automationToken')}</h4>
        {project.hasAutomationToken ? (
          <div className="ostler-settings-inline-actions">
            <TokenControls
              projectId={id}
              kind="automation"
              label={t('agents:agentsSection.automationToken')}
              copyDisabled={busy || !isHarnessPort(port)}
              copyTitle={t('agents:agentsSection.copiesAddressProjectId')}
              setError={setError}
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({
                  title: t('agents:agentsSection.createNewAutomationToken'),
                  body: t('agents:agentsSection.currentTokenStopsWorking'),
                  confirmLabel: t('agents:agentsSection.createNewToken'),
                  tone: 'danger'
                })
                if (!ok) return
                await act(async () => {
                  const result = await window.ostlerAPI.generateAutomationToken(id)
                  if (result.ok) replaceProject(result.value)
                  else setError(result.error)
                })
              }}
            >
              {t('agents:agentsSection.newToken')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({
                  title: t('agents:agentsSection.revokeAutomationToken'),
                  body: t('agents:agentsSection.stopsWorkingOnceAutomation'),
                  confirmLabel: t('agents:agentsSection.revokeToken'),
                  tone: 'danger'
                })
                if (!ok) return
                await act(async () => {
                  const result = await window.ostlerAPI.revokeAutomationToken(id)
                  if (result.ok) replaceProject(result.value)
                  else setError(result.error)
                })
              }}
            >
              {t('agents:agentsSection.revoke')}
            </Button>
          </div>
        ) : (
          <div>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  // Creating is undone by revoking, so it needs no question first.
                  const result = await window.ostlerAPI.generateAutomationToken(id)
                  if (!result.ok) return setError(result.error)
                  replaceProject(result.value)
                  toastUndo(t('agents:agentsSection.createdAutomationToken'), async () => {
                    const undone = await window.ostlerAPI.revokeAutomationToken(id)
                    if (undone.ok) replaceProject(undone.value)
                    else setError(undone.error)
                  })
                })
              }
            >
              {t('agents:agentsSection.createAutomationToken')}
            </Button>
          </div>
        )}
      </section>
      <ConnectAssistant project={project} port={port} setError={setError} />
    </div>
  )
}

/** Connect an AI assistant over MCP (D39): the address, the command and both client configurations. */
function ConnectAssistant({
  project,
  port,
  setError
}: {
  project: RendererProject
  port: number
  setError: (error: string | null) => void
}) {
  const [connection, setConnection] = useState<McpConnection | null>(null)
  const [copied, setCopied] = useState<McpClientForm | null>(null)
  const id = project.id
  const ready = project.hasAutomationToken && isHarnessPort(port)

  useEffect(() => {
    if (!ready) return setConnection(null)
    let current = true
    void window.ostlerAPI.describeMcpConnection(id).then((result) => {
      if (!current) return
      if (result.ok) setConnection(result.value)
      else setError(result.error)
    })
    return () => {
      current = false
    }
  }, [id, port, ready, setError])

  const copy = async (form: McpClientForm) => {
    const result = await window.ostlerAPI.copyMcpClientConfig(id, form)
    if (!result.ok) return setError(result.error)
    setCopied(form)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <section className="ostler-settings-subsection" aria-labelledby={`assistant-${id}`}>
      <h4 id={`assistant-${id}`}>{t('settings:connectionsSection.connectAssistant')}</h4>
      <p className="ostler-settings-text">{t('settings:connectionsSection.assistantCan')}</p>
      <p className="ostler-settings-hint">{t('settings:connectionsSection.assistantPrivacy')}</p>
      {!ready || !connection ? (
        <p className="ostler-settings-hint">{t('settings:connectionsSection.createTokenFirst')}</p>
      ) : (
        <>
          <dl className="ostler-settings-text">
            <dt>{t('settings:connectionsSection.address')}</dt>
            <dd>
              <code>{connection.url}</code>
            </dd>
            <dt>{t('settings:connectionsSection.command')}</dt>
            <dd>
              <code>{connection.command}</code>
            </dd>
          </dl>
          <TextArea
            label={t('settings:connectionsSection.httpConfig')}
            hint={t('settings:connectionsSection.httpConfigHint')}
            rows={6}
            readOnly
            value={connection.httpConfig}
          />
          <div>
            <Button size="sm" icon={Copy} onClick={() => void copy('http')}>
              {copied === 'http'
                ? t('settings:connectionsSection.copied')
                : t('settings:connectionsSection.copyHttp')}
            </Button>
          </div>
          <TextArea
            label={t('settings:connectionsSection.stdioConfig')}
            hint={t('settings:connectionsSection.stdioConfigHint')}
            rows={6}
            readOnly
            value={connection.stdioConfig}
          />
          <div>
            <Button size="sm" icon={Copy} onClick={() => void copy('stdio')}>
              {copied === 'stdio'
                ? t('settings:connectionsSection.copied')
                : t('settings:connectionsSection.copyStdio')}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
