import { BRAND } from './brand'
import { buildAutomationBaseUrl, buildHarnessBaseUrl } from './harness-url'

/**
 * Every prompt Ostler hands to an agent that carries a credential. They are
 * built only in the main process, which holds the tokens: the renderer asks
 * main to build one, main copies it to the clipboard, and the renderer shows
 * the masked preview (`maskSecrets`). One builder per prompt, so the copy a
 * human pastes and the preview they read never drift apart.
 */

/** How a secret is shown on screen: bullets and its last four characters. */
export function maskSecret(secret: string): string {
  return `••••${secret.slice(-4)}`
}

/** `text` with every occurrence of each non-empty secret masked. */
export function maskSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let masked = text
  for (const secret of secrets) {
    if (secret) masked = masked.split(secret).join(maskSecret(secret))
  }
  return masked
}

export interface HarnessSessionPromptTarget {
  id: string
  token: string
  workspace: { worktreePath: string; baseBranch: string; baseCommit: string } | null
}

export function buildHarnessSessionPrompt(
  port: number,
  projectId: string,
  session: HarnessSessionPromptTarget,
  task: { title: string; details: string | null }
): string {
  const baseUrl = buildHarnessBaseUrl(port, projectId)
  return (
    `Base URL: ${baseUrl}\n` +
    `Session ID: ${session.id}\n` +
    `\nAuthorization header:\nBearer ${session.token}\n\n` +
    (session.workspace ? `Your folder: ${session.workspace.worktreePath}\n\n` : '') +
    `You are session ${session.id}. Your task is already yours:\n` +
    `Task: ${task.title}\n` +
    (task.details ? `Details: ${task.details}\n` : '') +
    `\nFIRST ACTION — REQUIRED BEFORE STARTING WORK:\n` +
    `Run this command now:\n` +
    `curl.exe -fsS -H "Authorization: Bearer ${session.token}" "${baseUrl}/help"\n\n` +
    `Do not inspect files or begin the task until that request succeeds. It returns the harness API contract. If it fails, stop and report the connection error instead of working outside Ostler.\n\n` +
    `This session already exists. Never create or claim a task yourself.\n` +
    `Work only on the assigned task. REQUIRED HANDOFF DOCUMENTATION: before reporting completion, update the appropriate project documentation with what you changed, verification performed, issues or risks found, work that remains incomplete, and clear instructions or context for the next agent. Commit that documentation with your work. Then report completion through the documented session update route. If you need a human decision, use the documented question route.\n\n` +
    (session.workspace
      ? `Your folder is a copy of the project made for this task, starting from ${session.workspace.baseBranch} at ${session.workspace.baseCommit}. Do all work there and commit it there, never in the person's project folder. The person reviews your work and adds it to the project.`
      : `Work in the project directory directly.`)
  )
}

/** The automation-API connection text from Settings › Planning automation API. */
export function buildAutomationConnectionText(
  port: number,
  projectId: string,
  automationToken: string
): string {
  return [
    `Base URL: ${buildAutomationBaseUrl(port, projectId)}`,
    `Project ID: ${projectId}`,
    `Authorization: Bearer ${automationToken}`,
    '',
    'First call GET /help (with the Authorization header) to see the available routes and how to use them.'
  ].join('\n')
}

/** A project's MCP endpoint (D39): the automation API's base URL and /mcp. */
export function buildMcpUrl(port: number, projectId: string): string {
  return `${buildAutomationBaseUrl(port, projectId)}/mcp`
}

/** How an MCP client starts the stdio launcher: the executable, its arguments and environment. */
export interface McpStdioLaunch {
  command: string
  args: string[]
  env?: Record<string, string>
}

/** The launch as one command line, for reading and for a terminal. */
export function formatMcpStdioCommand(launch: McpStdioLaunch): string {
  const quote = (part: string) => (/[\s"]/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part)
  return [launch.command, ...launch.args].map(quote).join(' ')
}

/** The name a client lists the project's server under, e.g. `ostler-house-move`. */
export function mcpServerName(projectName: string, projectId: string): string {
  const slug = projectName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${BRAND.name.toLowerCase()}-${slug || projectId}`
}

/**
 * Client configuration for the HTTP form, in the `mcpServers` shape most MCP
 * clients read. It carries the automation token, so main builds and copies it.
 */
export function buildMcpHttpClientConfig(
  port: number,
  project: { id: string; name: string },
  automationToken: string
): string {
  const server = {
    type: 'http',
    url: buildMcpUrl(port, project.id),
    headers: { Authorization: `Bearer ${automationToken}` }
  }
  return JSON.stringify(
    { mcpServers: { [mcpServerName(project.name, project.id)]: server } },
    null,
    2
  )
}

/** Client configuration for the stdio form. No token: the launcher reads it itself. */
export function buildMcpStdioClientConfig(
  project: { id: string; name: string },
  launch: McpStdioLaunch
): string {
  const server = {
    command: launch.command,
    args: launch.args,
    ...(launch.env ? { env: launch.env } : {})
  }
  return JSON.stringify(
    { mcpServers: { [mcpServerName(project.name, project.id)]: server } },
    null,
    2
  )
}

const AUTOMATION_TASK_PROMPT = `You are being connected to Ostler, a project-management dashboard. It exposes a small local HTTP API ("the automation API") so you can read the current plan for a project and create or update goals, milestones, work items, and blockers on the human's behalf.

CONNECTION
Base URL: {{baseUrl}}
Project ID: {{projectId}}
Authorization header (send on every request except /help): Bearer {{token}}

Call GET {{baseUrl}}/help first (no auth needed) to confirm the route list.

RESPONSE ENVELOPE
Every response is JSON: {"ok":true,"value":...} on success, or {"ok":false,"error":"..."} on failure. Status codes: 200 success, 400 invalid request, 401 bad/missing token, 404 unknown route/project. Always check "ok" before trusting "value".

CONCEPTS
Goal -> Milestone -> Work item is the planning hierarchy (a work item is a task/ticket). A separate "harness task" is a queue entry that gets an agent to actually execute something now; create one explicitly if you want work picked up, or pass autoQueue:true when creating a work item. A blocker records something stopping a work item from progressing.

ENDPOINTS (all paths below are relative to the base URL above)
GET  /help                                no auth
GET  /status                              queue counts, planning status/metrics
GET  /report                              full harness report
GET  /tasks                               list queued harness tasks
POST /tasks                               {title, description?, details?, priority?, workItemId?}
POST /tasks/reorder                       {taskIds: string[]}
PATCH /tasks/:taskId/priority             {priority}
GET  /goals                               list goals
POST /goals                               {title, outcome?}
PATCH /goals/:goalId                      {title?, outcome?, status?}
POST /goals/:goalId/split                 {items:[{type:"milestone"|"work-item", ...fields}]} -> per-item {index, ok, value|error}
GET  /milestones                          list milestones
POST /milestones                          {name, outcome?, goalId?, targetDate?, successCriteria?}
PATCH /milestones/:milestoneId            same fields, all optional
GET  /work-items                          list work items
POST /work-items                          {title, description?, status?, priority?, milestoneId?, labels?, acceptanceCriteria?, dependencyIds?, dependencyLinks?, targetDate?, autoQueue?}
PATCH /work-items/:workItemId             same fields as POST
GET  /blockers                            list blockers (each includes its work item)
POST /blockers                            {workItemId, description, resolutionOptions?}
POST /blockers/:blockerId/resolve         {choice, note?}

Priority values: "low" | "medium" | "high" | "critical". IDs are opaque strings returned by prior calls - never invent one. This token only grants access to this one project. Errors are informative - relay "error" back to the human rather than retrying blindly.

YOUR TASK
{{task}}`

/** The Agent Task Prompt card's prompt: the automation API's instructions plus the human's task. */
export function buildAutomationTaskPrompt(
  port: number,
  projectId: string,
  automationToken: string,
  task: string
): string {
  const baseUrl = buildAutomationBaseUrl(port, projectId)
  return AUTOMATION_TASK_PROMPT.replace('{{baseUrl}}', baseUrl)
    .replace('{{baseUrl}}', baseUrl)
    .replace('{{projectId}}', projectId)
    .replace('{{token}}', automationToken)
    .replace('{{task}}', task.trim() || '(describe what you want the agent to do here)')
}
