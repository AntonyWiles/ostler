import type { parseReportExtras } from '@shared/agent-report-extras'
import type { AIEffortLevel, HarnessReportedUsage, WatchedProject } from '@shared/ostler-api'

/** What the runner keeps about one embedded session while it runs. */
export interface RunningEmbeddedSession {
  project: WatchedProject
  /** The provider and model this run started with; every later turn uses the same. */
  target: { providerID: string; modelID: string; effort?: AIEffortLevel }
  sessionId: string
  taskId: string | null
  pid: number
  port: number
  password: string
  openCodeSessionId: string
  pollTimer: NodeJS.Timeout | null
  stopped: boolean
  lastMessageCount?: number
  slotPath: string
  bridgeSecret: string
  toolCallCount: number
  /** Timestamps (ms) of tool calls within the current rolling rate-limit window, oldest first. */
  toolCallTimestamps: number[]
  /** The previous call's tool+arguments fingerprint, for consecutive-repeat detection. */
  lastToolCallFingerprint: string | null
  /** How many times in a row that same fingerprint has been called. */
  consecutiveToolCallRepeats: number
  turnCount: number
  maxToolCallsPerMinute: number
  /** True while the initial sendMessage() HTTP call is still in flight. A `session.status: idle` event can arrive over the plugin bridge before that call's own HTTP response comes back (they race over the same underlying request), so an idle event received while this is true does not yet mean the turn genuinely succeeded -- see deferredFinishReason. */
  initialMessagePending: boolean
  /** Set instead of calling finish() when an idle/error event arrives while initialMessagePending is still true. Resolved once sendMessage() settles: applied if it succeeded, discarded (in favor of the real failure) if it didn't. */
  deferredFinishReason: string | null
  /** True while a continuation nudge's own sendMessage() is in flight; defers finishing for exactly the same reason initialMessagePending does. */
  nudgePending: boolean
  /** Continuation nudges sent so far, capped by `maxContinuationNudges`. */
  nudgeCount: number
  /**
   * Messages from the person (D41) whose post into the session is still in
   * flight. Defers finishing like a nudge does, and never counts as a nudge.
   */
  guidancePending: number
  /**
   * True once the model has actually produced something in this session --
   * assistant text or a tool call. Until then nothing has run, whatever else
   * the session looks like: opencode accepting a request, going idle, and
   * ending is indistinguishable from an agent that worked unless this is
   * checked, which is how a session where the AI never answered came to be
   * recorded as a completed task.
   */
  modelResponded: boolean
  /** Last sign of life (ms): any bridge call from the plugin -- tool call, tool result or event. */
  lastProgressAt: number
  /** The tool call that has started and not yet returned, if any. */
  toolInFlight: { tool: string; startedAt: number; declaredTimeoutMs: number | null } | null
  stallTimer: NodeJS.Timeout | null
  /** Guards the async stall check against overlapping itself. */
  stallCheckRunning: boolean
  /** Set while the watchdog considers the session stuck; cleared on the next sign of life. */
  stall: { since: string; reason: string } | null
  stallAborts: number
  /** When the watchdog last asked opencode to abort; cleared on the next sign of life. */
  abortRequestedAt: number | null
  /**
   * True from a stall abort until the nudge that follows it is sent. An
   * aborted turn surfaces as an error or a failed send, which would otherwise
   * end the session; this marks it as Ostler's own intervention instead.
   */
  abortedForStall: boolean
  /** What the watchdog aborted, for the nudge that tells the agent about it. */
  stallNote: string | null
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  /**
   * Tokens per assistant message, as opencode reports them. A message's
   * tokens grow as it streams, so each message keeps its latest count and the
   * run's usage is their sum across every turn (R5.3).
   */
  messageUsage: Map<string, { input: number; output: number }>
  /**
   * Set once the run crosses a token limit (D43): the note it ends with. The
   * run is stopped at its next turn boundary through the ordinary end path.
   */
  limitStop: string | null
  /** When Ostler asked opencode to end the turn for the limit. */
  limitAbortAt: number | null
  /**
   * Plan first (N9.3a): when the open `ostler_submit_plan` wait began, or
   * null when none is open. Waiting on the person is not the agent stalling,
   * and does not count against the turn's budget.
   */
  planWaitStartedAt?: number | null
  /** Time spent on finished plan waits so far, in ms. */
  planWaitedMs?: number
  completionReport?: {
    summary: string
    filesChanged: string[]
    verification: string
    blockers: string
    /** The token usage the agent reported (R5.3), when it did. */
    usage?: HarnessReportedUsage
    /** Pictures and a walkthrough (N9.1), read by the same rule as the harness API's. */
    extras?: ReturnType<typeof parseReportExtras>
  }
  /**
   * The model provider's error on the latest turn (e.g. "The backend is
   * temporarily overloaded"), cleared by any real output after it. A turn that
   * ends on one did not end because the agent stopped working.
   */
  providerError?: string | null
  /**
   * The session ended for a reason outside the agent's control -- a provider
   * failure, Ostler itself going away -- so its task goes back to the queue
   * instead of being held as abandoned.
   */
  endedExternally?: boolean
}

/** What deciding a session's outcome needs, which a session Ostler is no longer running still has. */
export type SessionOutcomeSubject = Pick<
  RunningEmbeddedSession,
  'project' | 'sessionId' | 'taskId' | 'modelResponded' | 'completionReport' | 'endedExternally'
>

/** An `ostler_ask_question` call held open until the person answers. */
export interface PendingQuestion {
  questionId: string
  sessionId: string
  resolve: (answer: string) => void
  reject: (err: Error) => void
  /** Fires when the human has not answered in time; cleared on answer or session stop. */
  timer: NodeJS.Timeout
}
