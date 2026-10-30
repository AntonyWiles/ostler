import {
  type McpClientForm,
  type McpConnection,
  type ProjectTokenKind,
  type WatchedProject
} from '@shared/ostler-api'
import {
  buildAutomationConnectionText,
  buildAutomationTaskPrompt,
  buildHarnessSessionPrompt,
  buildMcpHttpClientConfig,
  buildMcpStdioClientConfig,
  buildMcpUrl,
  formatMcpStdioCommand,
  maskSecrets,
  type McpStdioLaunch
} from '@shared/agent-prompts'
import type { ConfigStore } from '../config-store'
import type { HarnessService } from '../services/harness-service'
import { handleApi } from './handle-ipc'
import { copyText } from '../app/clipboard'
import { t } from '@shared/i18n'

/**
 * Copies a prompt that carries secrets and returns it with them masked: the
 * real text goes only to the clipboard, the renderer gets the preview.
 */
export function copyPromptWithSecrets(text: string, secrets: (string | undefined)[]): string {
  copyText(text)
  return maskSecrets(text, secrets)
}

export interface AgentPromptHandlerDependencies {
  configStore: ConfigStore
  harnessService: HarnessService
  getProject(projectId: string): WatchedProject
  /** How an MCP client starts this executable as the project's stdio launcher (D39). */
  mcpStdioLaunch(projectId: string): McpStdioLaunch
}

const isTokenKind = (kind: unknown): kind is ProjectTokenKind => kind === 'automation'

/**
 * The prompts and token reads that need a secret the renderer does not hold.
 * Every one resolves the project first (the access check), builds the text
 * from `@shared/agent-prompts`, and copies it.
 */
export function registerAgentPromptHandlers({
  configStore,
  harnessService,
  getProject,
  mcpStdioLaunch
}: AgentPromptHandlerDependencies): void {
  const automationToken = (project: WatchedProject): string => {
    if (!project.automationToken)
      throw new Error(t('errors:agentPromptHandlers.generateAutomationTokenFirst'))
    return project.automationToken
  }

  handleApi('copyHarnessSessionPrompt', (_event, projectId: string, sessionId: string) => {
    const project = getProject(projectId)
    const state = harnessService.getState(project)
    const session = state.activeSessions.find((item) => item.id === sessionId)
    if (!session) throw new Error(t('errors:agentPromptHandlers.agentNoLongerRunning'))
    const task =
      state.taskQueue.find((item) => item.id === session.taskId) ??
      state.taskQueue.find((item) => item.claimedBy === session.id)
    if (!task) throw new Error(t('errors:agentPromptHandlers.taskAgentCouldNot'))
    const prompt = buildHarnessSessionPrompt(configStore.get().harness.port, project.id, session, {
      title: task.title,
      details: task.details ?? null
    })
    return copyPromptWithSecrets(prompt, [session.token])
  })

  handleApi('copyAutomationTaskPrompt', (_event, projectId: string, task: string) => {
    const project = getProject(projectId)
    if (typeof task !== 'string' || task.length > 20_000) throw new Error('Invalid task text')
    const token = automationToken(project)
    const prompt = buildAutomationTaskPrompt(
      configStore.get().automationApi.port,
      project.id,
      token,
      task
    )
    return copyPromptWithSecrets(prompt, [token])
  })

  handleApi('copyProjectConnection', (_event, projectId: string, kind: ProjectTokenKind) => {
    const project = getProject(projectId)
    if (!isTokenKind(kind)) throw new Error('Unknown token')
    const config = configStore.get()
    const token = automationToken(project)
    const text = buildAutomationConnectionText(config.automationApi.port, project.id, token)
    return copyPromptWithSecrets(text, [token])
  })

  // Connect an AI assistant (D39): the HTTP form carries the token, the stdio
  // form never does, since the launcher reads it from the data folder.
  const mcpTexts = (projectId: string) => {
    const project = getProject(projectId)
    const token = automationToken(project)
    const port = configStore.get().automationApi.port
    const launch = mcpStdioLaunch(project.id)
    return {
      token,
      url: buildMcpUrl(port, project.id),
      command: formatMcpStdioCommand(launch),
      http: buildMcpHttpClientConfig(port, project, token),
      stdio: buildMcpStdioClientConfig(project, launch)
    }
  }

  handleApi('describeMcpConnection', (_event, projectId: string): McpConnection => {
    const texts = mcpTexts(projectId)
    return {
      url: texts.url,
      command: texts.command,
      httpConfig: maskSecrets(texts.http, [texts.token]),
      stdioConfig: texts.stdio
    }
  })

  handleApi('copyMcpClientConfig', (_event, projectId: string, form: McpClientForm) => {
    if (form !== 'http' && form !== 'stdio') throw new Error('Unknown connection form')
    const texts = mcpTexts(projectId)
    return copyPromptWithSecrets(form === 'http' ? texts.http : texts.stdio, [texts.token])
  })

  // The one place a token reaches the renderer: an explicit Reveal in Settings.
  handleApi('revealProjectToken', (_event, projectId: string, kind: ProjectTokenKind) => {
    const project = getProject(projectId)
    if (!isTokenKind(kind)) throw new Error('Unknown token')
    return automationToken(project)
  })
}
