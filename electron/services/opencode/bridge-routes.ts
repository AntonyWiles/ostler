import type { IncomingMessage } from 'http'
import { parseReportExtras } from '@shared/agent-report-extras'
import type {
  HarnessEmbeddedRuntime,
  HarnessPlan,
  SessionTranscriptEntry
} from '@shared/ostler-api'
import { PLAN_FIRST_AVAILABLE } from '@shared/plan-first'
import { REVIEW_RUN_REFUSAL, REVIEWER_RUNS_AVAILABLE } from '@shared/reviewer-runs'
import type { HarnessService } from '../harness-service'
import {
  checkWorkEvidence,
  parseReportedUsage,
  reportFiles,
  reportText
} from '../harness/report-rules'
import type { PendingQuestion, RunningEmbeddedSession } from './running-session'

/**
 * The embedded runner's plugin bridge: one handler per path the Ostler plugin
 * inside opencode posts to. `OpenCodeRunnerService.handleBridgeRequest` reads
 * the body, checks the session's bridge secret, and dispatches here.
 */

export const TOOL_CALL_RATE_WINDOW_MS = 60_000

/** The embedded plan-first tool (N9.3a). */
const PLAN_TOOL = 'ostler_submit_plan'

/** opencode's tools that change files: refused before a plan-first task's plan is approved. */
export const FILE_EDITING_TOOLS = new Set(['edit', 'write', 'patch', 'multiedit', 'apply_patch'])

/** What the bridge handlers need from the runner. */
export interface BridgeHost {
  readonly harnessService: HarnessService
  readonly deps: {
    repeatedToolCallLimit: number
    maxToolCallsPerSession: number
    questionTimeoutMs: number
  }
  readonly pendingQuestions: Map<string, PendingQuestion>
  log(message: string): void
  recordTranscript(sessionId: string, entry: SessionTranscriptEntry): void
  syncSessionRuntimeStats(
    running: RunningEmbeddedSession,
    overrides?: Partial<HarnessEmbeddedRuntime>
  ): void
  stopForRateLimit(
    running: RunningEmbeddedSession,
    respond?: () => void,
    capDescription?: string
  ): Promise<void>
  abortTurnForLimit(running: RunningEmbeddedSession): Promise<void>
  handlePluginEvent(
    running: RunningEmbeddedSession,
    event?: { id?: string; type?: string; properties?: Record<string, unknown> }
  ): Promise<void>
  waitForPlanDecision(running: RunningEmbeddedSession, version: number): Promise<HarnessPlan | null>
}

/** One authenticated bridge call. */
export interface BridgeCall {
  host: BridgeHost
  running: RunningEmbeddedSession
  body: Record<string, unknown>
  respond: (status: number, payload: Record<string, unknown>) => void
}

type BridgeRoute = (call: BridgeCall) => Promise<void> | void

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, unknown>
}

/**
 * What `ostler_submit_plan` answers (N9.3a): the person's decision on the plan
 * version the agent sent, or word that it still waits. Text for agents.
 */
export function planDecisionMessage(plan: HarnessPlan | null, version: number): string {
  if (!plan || plan.status === 'cancelled') {
    return 'CANCELLED: the person cancelled this task. Stop now: change nothing more and end your turn.'
  }
  if (plan.version !== version) {
    return `Your plan is now at version ${plan.version}. Call ostler_submit_plan again with the plan you want the person to decide on.`
  }
  if (plan.status === 'approved') {
    return `APPROVED: the person approved your plan (version ${plan.version}). Carry on now: do the task as planned, commit your changes, then call ostler_complete_task as your final action. If the work turns out to need something the plan did not say, ask with ostler_ask_question first.`
  }
  if (plan.status === 'changes-requested') {
    return [
      `CHANGES REQUESTED: the person asked for changes to your plan (version ${plan.version}). Their note:`,
      plan.changesNote ?? '',
      'Revise the plan and call ostler_submit_plan again with the new plan. Do not change files yet.'
    ].join('\n')
  }
  return `STILL WAITING: your plan (version ${plan.version}) still awaits the person's approval. Do not change files. Call ostler_submit_plan again with the same plan to keep waiting.`
}

/**
 * The argument that says what a call actually did, per tool. "Executed tool:
 * bash" was true of every shell command the agent ever ran and told the reader
 * nothing; the command itself is the thing worth showing.
 */
const TOOL_HEADLINE_ARGS = [
  'command',
  'filePath',
  'path',
  'file',
  'pattern',
  'query',
  'url',
  'description'
]

/** Renders one tool call as `bash · npm test`, falling back to the tool name. */
function describeToolCall(tool: string, args: Record<string, unknown> | undefined): string {
  if (!args || typeof args !== 'object') return tool
  const headline = TOOL_HEADLINE_ARGS.map((key) => args[key]).find(
    (value) => typeof value === 'string' && value.trim()
  )
  const rest = Object.entries(args)
    .filter(([, value]) => value !== headline && typeof value === 'string' && value.trim())
    .map(([key, value]) => `${key}: ${String(value)}`)
  const parts = [headline ? `${tool} · ${String(headline).trim()}` : tool, ...rest]
  return parts.join('\n').slice(0, 4000)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const toolCall: BridgeRoute = async ({ host, running, body, respond }) => {
  const { sessionId } = running
  running.toolCallCount += 1
  running.modelResponded = true
  running.providerError = null
  const now = Date.now()
  running.toolCallTimestamps.push(now)
  const windowStart = now - TOOL_CALL_RATE_WINDOW_MS
  while (running.toolCallTimestamps.length && running.toolCallTimestamps[0] < windowStart) {
    running.toolCallTimestamps.shift()
  }
  const callsInWindow = running.toolCallTimestamps.length
  const tool = String(body.tool ?? 'unknown')
  const args = (body.args ?? undefined) as Record<string, unknown> | undefined
  host.log(
    `${sessionId}: tool call #${running.toolCallCount} (${tool}) intercepted (${callsInWindow}/${running.maxToolCallsPerMinute} in the last minute)`
  )

  host.recordTranscript(sessionId, {
    role: 'tool',
    content: describeToolCall(tool, args),
    timestamp: new Date().toISOString()
  })

  host.harnessService.touchSessionConnection(running.project, running.sessionId)
  host.syncSessionRuntimeStats(running, { toolCallsInLastMinute: callsInWindow })

  // A review run (N9.5a) changes nothing. A guard, not a sandbox: whatever
  // it does change is thrown away with its copy.
  if (
    REVIEWER_RUNS_AVAILABLE &&
    FILE_EDITING_TOOLS.has(tool) &&
    host.harnessService.sessionReviewOf(running.project, running.sessionId)
  ) {
    host.recordTranscript(sessionId, {
      role: 'system',
      content: `[Ostler] Refused ${tool}: a review run changes nothing.`,
      timestamp: new Date().toISOString()
    })
    respond(200, { ok: true, reviewRefused: REVIEW_RUN_REFUSAL })
    return
  }

  // Plan first (N9.3a): no file edits until the plan is approved. A guard,
  // not a sandbox: the check at approval records what really changed.
  if (
    PLAN_FIRST_AVAILABLE &&
    FILE_EDITING_TOOLS.has(tool) &&
    !host.harnessService.sessionMayChangeFiles(running.project, running.sessionId)
  ) {
    host.recordTranscript(sessionId, {
      role: 'system',
      content: `[Ostler] Refused ${tool}: the plan is not approved yet.`,
      timestamp: new Date().toISOString()
    })
    respond(200, {
      ok: true,
      refused:
        'this task asks for a plan first, and no plan of yours is approved yet. Do not change files: send your plan with ostler_submit_plan and wait for the decision.'
    })
    return
  }

  // Soft tier, checked before the hard caps: refuse just this one call and
  // tell the agent it is looping. Cheap, recoverable, and costs no slot.
  //
  // Consecutive repeats only. A loop is the same call back-to-back; the same
  // `git status` run three times across a long session is just ordinary
  // work, and counting those would refuse calls that were never a problem.
  const fingerprint = `${tool}::${JSON.stringify(args ?? {})}`
  // Sending the same plan again is how an agent keeps waiting on the person.
  const repeats =
    running.lastToolCallFingerprint === fingerprint && tool !== PLAN_TOOL
      ? running.consecutiveToolCallRepeats + 1
      : 1
  running.lastToolCallFingerprint = fingerprint
  running.consecutiveToolCallRepeats = repeats
  if (repeats >= host.deps.repeatedToolCallLimit) {
    // Reset so the next run of identical calls has to earn its own warning,
    // rather than every subsequent call being refused forever.
    running.consecutiveToolCallRepeats = 0
    host.log(
      `${sessionId}: refused a repeated identical ${tool} call (${repeats} times) and warned the agent`
    )
    host.recordTranscript(sessionId, {
      role: 'system',
      content: `[Ostler] Refused a repeated identical call to ${tool} (${repeats} times in a row) and told the agent to change approach.`,
      timestamp: new Date().toISOString()
    })
    respond(200, {
      ok: false,
      warn: `You have now called ${tool} with identical arguments ${repeats} times in a row. Repeating it will not produce a different result, so Ostler refused this call. Change approach: use what you already learned, try a different tool or different arguments, or -- if you are genuinely stuck on something only a human can resolve -- call ostler_ask_question. If the task cannot be completed, call ostler_complete_task and say so in \`blockers\`.`
    })
    return
  }

  if (running.toolCallCount > host.deps.maxToolCallsPerSession) {
    host.log(
      `[SESSION CAP EXCEEDED] Session ${sessionId} made ${running.toolCallCount} tool calls (lifetime limit ${host.deps.maxToolCallsPerSession}). Stopping for human review.`
    )
    await host.stopForRateLimit(
      running,
      () => {
        respond(200, {
          ok: false,
          blocked: true,
          error: `Session exceeded its lifetime tool-call budget of ${host.deps.maxToolCallsPerSession} calls.`
        })
      },
      `exceeded its lifetime tool-call budget of ${host.deps.maxToolCallsPerSession} calls`
    )
    return
  }

  if (callsInWindow >= running.maxToolCallsPerMinute) {
    host.log(
      `[RATE LIMIT EXCEEDED] Session ${sessionId} made ${callsInWindow} tool calls in the last minute (limit ${running.maxToolCallsPerMinute}). Stopping for human review.`
    )
    // The agent still gets its "blocked" answer, but only once the session
    // has actually been torn down and marked for review -- and just before
    // its process is killed. Answering first left a window where the
    // caller had been told it was blocked while the session still counted
    // as running.
    await host.stopForRateLimit(running, () => {
      respond(200, {
        ok: false,
        blocked: true,
        error: `Session exceeded the configured tool-call rate limit of ${running.maxToolCallsPerMinute} calls/minute.`
      })
    })
    return
  }

  // Ostler's own tools are exempt: ostler_ask_question legitimately blocks
  // for as long as a human takes to answer, under its own timeout.
  if (!tool.startsWith('ostler_')) {
    const declared = Number(args?.timeout)
    running.toolInFlight = {
      tool,
      startedAt: now,
      declaredTimeoutMs: Number.isFinite(declared) && declared > 0 ? declared : null
    }
  }

  respond(200, { ok: true })
}

const toolResult: BridgeRoute = ({ host, running, body, respond }) => {
  running.toolInFlight = null
  // A run past its token limit ends here, between calls, never inside one.
  if (running.limitStop && running.limitAbortAt === null) void host.abortTurnForLimit(running)
  const tool = String(body.tool ?? 'unknown')
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const output = typeof body.output === 'string' ? body.output.trim() : ''
  // A call with no output to speak of would only pad the feed between the
  // command and whatever the agent did next.
  if (title || output) {
    host.recordTranscript(running.sessionId, {
      role: 'tool',
      content: [`${tool} →`, title, output].filter(Boolean).join('\n').slice(0, 4000),
      timestamp: new Date().toISOString()
    })
  }
  respond(200, { ok: true })
}

const pluginEvent: BridgeRoute = async ({ host, running, body, respond }) => {
  await host.handlePluginEvent(
    running,
    body.event as { id?: string; type?: string; properties?: Record<string, unknown> }
  )
  respond(200, { ok: true })
}

const ask: BridgeRoute = async ({ host, running, body, respond }) => {
  const { sessionId } = running
  const questionText = typeof body.question === 'string' ? body.question.trim() : ''
  if (!questionText) {
    respond(400, { ok: false, error: 'Question text is required' })
    return
  }

  host.log(`${sessionId}: agent asked question via tool: ${questionText}`)
  host.recordTranscript(sessionId, {
    role: 'assistant',
    content: `[Question to human] ${questionText}`,
    timestamp: new Date().toISOString()
  })
  const question = host.harnessService.askQuestion(running.project, running.sessionId, questionText)

  try {
    // Bounded on purpose. This HTTP response is held open for the whole
    // wait, and it is held open *inside* the agent's turn -- so an
    // unanswered question used to burn the entire sendMessageTimeoutMs
    // budget, abort the turn, and kill the session with its work
    // uncommitted, at which point the human's answer arrived to a dead
    // process. Timing the question out instead keeps the session alive and
    // lets the agent proceed on its own judgment.
    const answer = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        host.pendingQuestions.delete(question.id)
        host.log(`${sessionId}: question ${question.id} went unanswered; releasing the agent`)
        host.recordTranscript(sessionId, {
          role: 'system',
          content: `[Ostler] No human answer within ${Math.round(
            host.deps.questionTimeoutMs / 60_000
          )} minutes. The agent was told to proceed on its own judgment and record the assumption.`,
          timestamp: new Date().toISOString()
        })
        resolve(
          [
            'NO ANSWER YET: nobody answered within the time limit, and waiting longer would end this session with your work unfinished.',
            'Proceed on your best judgment now. State the assumption you made in your commit message, and repeat it in the `blockers` field of ostler_complete_task so a human can revisit it.',
            'Do not ask this question again.'
          ].join('\n')
        )
      }, host.deps.questionTimeoutMs)
      host.pendingQuestions.set(question.id, {
        questionId: question.id,
        sessionId,
        resolve,
        reject,
        timer
      })
    })

    host.log(`${sessionId}: question ${question.id} answered: ${answer}`)
    respond(200, { ok: true, answer })
  } catch (err) {
    respond(500, { ok: false, error: errorText(err) })
  }
}

const plan: BridgeRoute = async ({ host, running, body, respond }) => {
  let submitted: HarnessPlan
  try {
    submitted = host.harnessService.submitPlan(running.project, running.sessionId, {
      steps: body.steps,
      files: body.files,
      risks: body.risks
    })
  } catch (error) {
    respond(400, { ok: false, error: errorText(error) })
    return
  }
  host.recordTranscript(running.sessionId, {
    role: 'assistant',
    content: `[Plan, version ${submitted.version}]\n${submitted.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
    timestamp: new Date().toISOString()
  })
  const decided = await host.waitForPlanDecision(running, submitted.version)
  respond(200, { ok: true, message: planDecisionMessage(decided, submitted.version) })
}

const complete: BridgeRoute = async ({ host, running, body, respond }) => {
  const { sessionId } = running
  // Read by the same rules as an external agent's report (report-rules.ts).
  const summary = reportText(body.summary)
  const filesChanged = reportFiles(body.filesChanged)
  const verification = reportText(body.verification)
  const blockers = reportText(body.blockers)
  const usage = parseReportedUsage(body.usage)
  if (!summary || !verification || !blockers) {
    respond(400, { ok: false, error: 'summary, verification, and blockers are required' })
    return
  }
  // An agent can call this as its very first action with a summary it
  // invented, which recorded the task complete before it had touched
  // anything. The branch is the check (`checkWorkEvidence`). An unreadable
  // diff is not proof of idleness, so it lets the report through.
  const diff = await host.harnessService
    .getSessionDiff(running.project, running.sessionId)
    .catch(() => null)
  const refusal = diff && checkWorkEvidence(diff, { filesChanged })
  if (refusal) {
    host.log(`${sessionId}: completion report refused -- no work on the branch`)
    host.recordTranscript(sessionId, {
      role: 'system',
      content:
        '[Ostler] Completion refused: the report claims changed files, but this workspace has no commits and no edits.',
      timestamp: new Date().toISOString()
    })
    respond(409, { ok: false, error: refusal })
    return
  }
  running.completionReport = {
    summary,
    filesChanged,
    verification,
    blockers,
    ...(usage ? { usage } : {}),
    extras: parseReportExtras(body)
  }
  host.log(`${sessionId}: structured completion report received`)
  host.recordTranscript(sessionId, {
    role: 'assistant',
    content: `[Structured completion] ${summary}\nVerification: ${verification}\nBlockers: ${blockers}`,
    timestamp: new Date().toISOString()
  })
  respond(200, { ok: true })
}

const securityViolation: BridgeRoute = ({ host, running, body, respond }) => {
  const tool = String(body.tool ?? 'unknown')
  const targetPath = String(body.targetPath ?? 'unknown')
  const reason = String(body.reason ?? 'defense-in-depth check failed')
  host.log(
    `[SECURITY VIOLATION] Session ${running.sessionId} tool ${tool} blocked on target ${targetPath}: ${reason}`
  )
  host.recordTranscript(running.sessionId, {
    role: 'system',
    content: `[Defense-in-depth blocked] Tool ${tool} on target ${targetPath}: ${reason}`,
    timestamp: new Date().toISOString()
  })
  respond(200, { ok: true })
}

const BRIDGE_ROUTES: Record<string, BridgeRoute> = {
  '/tool-call': toolCall,
  '/tool-result': toolResult,
  '/event': pluginEvent,
  '/ask': ask,
  '/plan': plan,
  '/complete': complete,
  '/security-violation': securityViolation
}

/** The handler for a bridge path, or undefined when there is none (plans only while plan first is on). */
export function bridgeRoute(pathname: string): BridgeRoute | undefined {
  if (pathname === '/plan' && !PLAN_FIRST_AVAILABLE) return undefined
  return Object.hasOwn(BRIDGE_ROUTES, pathname) ? BRIDGE_ROUTES[pathname] : undefined
}
