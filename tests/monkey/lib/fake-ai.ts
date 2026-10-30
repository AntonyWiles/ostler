import * as fs from 'fs'
import * as http from 'node:http'
import * as path from 'path'

/**
 * A stand-in AI provider for monkey runs: an OpenAI-compatible server on
 * loopback that answers every Ostler AI feature with a plausible, valid answer
 * about the dummy project, instantly and for free. It recognises each feature
 * by the wording of the prompt Ostler sends (src/shared/ostler-ai-prompts.ts),
 * so it exercises the real parsing, review and approval screens.
 *
 * It also logs what Ostler sent (`fake-ai-requests.jsonl`: which feature, how
 * big, whether the brief or library came along), which is evidence for the
 * privacy page's claims, and can be told to fail the next request on purpose
 * (`POST /__control`), so error handling gets exercised too.
 */

export const FAKE_AI_MODEL = 'monkey-fake-model'

type Failure = 'http-500' | 'http-401' | 'not-json' | 'truncated' | 'slow'

interface ChatRequest {
  model?: string
  stream?: boolean
  messages?: { role: string; content: unknown }[]
  tools?: unknown[]
}

export interface FakeAi {
  url: string
  port: number
  close(): Promise<void>
  /** The next request fails this way, once. */
  failNext(failure: Failure): void
  /** How many requests each feature got. */
  counts(): Record<string, number>
}

function text(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text: unknown }).text)
          : ''
      )
      .join('\n')
  }
  return ''
}

/** The JSON Ostler put after a marker line, or null. */
function evidenceAfter(prompt: string, marker: string): Record<string, unknown> | null {
  const at = prompt.indexOf(marker)
  if (at === -1) return null
  const rest = prompt.slice(at + marker.length).trim()
  const end = rest.lastIndexOf('}')
  if (end === -1) return null
  for (let cut = end; cut > 0; cut = rest.lastIndexOf('}', cut - 1)) {
    try {
      return JSON.parse(rest.slice(0, cut + 1)) as Record<string, unknown>
    } catch {
      // The library context follows the evidence; try a shorter slice.
    }
  }
  return null
}

const TASKS = [
  {
    title: 'Show the remaining time in the window title',
    description:
      'While a session runs, the window title reads "12:34 — Focus" so the time is visible from the taskbar. When stopped it reads "Pomodoro Desk".',
    priority: 'medium',
    acceptanceCriteria: [
      'The title updates every second while running',
      'The title resets to "Pomodoro Desk" on Reset'
    ]
  },
  {
    title: 'Remember the window position between runs',
    description:
      'Save the main window position and size to settings.json on close and restore them on start, falling back to the centre of the primary screen when the saved position is off-screen.',
    priority: 'low',
    acceptanceCriteria: [
      'Position survives a restart',
      'An off-screen position falls back to centred'
    ]
  },
  {
    title: 'Add a "Skip break" button',
    description:
      'During a break, a Skip break button ends the break and starts the next focus session. It is hidden during focus sessions.',
    priority: 'medium',
    acceptanceCriteria: ['Visible only during breaks', 'Skipping counts the break as finished']
  },
  {
    title: 'Count finished focus sessions today',
    description:
      'Show "Today: 3" under the timer: the focus sessions finished since midnight. The count resets at midnight and is stored in settings.json.',
    priority: 'medium',
    acceptanceCriteria: ['The count rises when a focus session ends', 'It resets at midnight']
  },
  {
    title: 'Write the user guide section of the README',
    description:
      'Add a "Using Pomodoro Desk" section: the buttons, the keyboard shortcuts (Space, R, S), where settings live and how to change durations.',
    priority: 'low',
    acceptanceCriteria: ['Every shortcut is listed', 'The settings path is given']
  }
]

function nextTasks(): string {
  return JSON.stringify({
    summary: 'The timer works end to end; these five close the gaps people notice first.',
    assumptions: ['The project is a .NET 8 WinForms app'],
    warnings: [],
    suggestions: TASKS.map((task, index) => ({
      ...task,
      rationale: `Suggested because the current plan has no task covering it (${index + 1} of 5).`,
      evidence: ['The task list for this project'],
      attachments: []
    }))
  })
}

function goalBreakdown(): string {
  return JSON.stringify({
    summary: 'Four small steps take the goal from an empty folder to a usable timer.',
    assumptions: ['.NET 8 SDK is installed'],
    warnings: ['No tests exist yet; the first task adds them.'],
    suggestions: [
      {
        title: 'Create the solution and projects',
        description:
          'Create PomodoroDesk.sln with src/PomodoroDesk (WinForms, net8.0-windows), src/PomodoroDesk.Core (class library) and tests/PomodoroDesk.Core.Tests (xUnit).',
        priority: 'high',
        acceptanceCriteria: ['dotnet build succeeds', 'dotnet test runs with zero tests failing'],
        rationale: 'Everything else builds on it.',
        evidence: ['The goal'],
        attachments: []
      },
      {
        title: 'Write the timer state machine',
        description:
          'PomodoroTimer in Core: Focus 25 min, short break 5 min, long break 15 min after every fourth focus. Time comes from an injected clock so tests need no waiting.',
        priority: 'high',
        acceptanceCriteria: ['Unit tests cover every transition', 'No UI code in Core'],
        rationale: 'The core logic must be testable on its own.',
        evidence: ['The goal'],
        attachments: []
      },
      ...TASKS.slice(0, 2).map((task) => ({
        ...task,
        rationale: 'Part of the goal as written.',
        evidence: ['The goal'],
        attachments: []
      }))
    ]
  })
}

function milestoneAdvisory(prompt: string): string {
  const ready = /"readyToClose":\s*true/.test(prompt)
  return JSON.stringify({
    health: 'on-track',
    headline: ready ? 'Everything linked is done; it can close.' : 'On track, with one gap.',
    summary: ready
      ? 'All linked tasks are done and nothing in the evidence argues against closing.'
      : 'The linked tasks cover the outcome except for a check that the app starts on a clean machine.',
    recommendations: ready
      ? []
      : [
          {
            title: 'Add a clean-machine start check',
            rationale: 'Nothing confirms the app starts without the SDK installed.',
            evidence: ['The milestone success criteria'],
            action: {
              kind: 'add-success-criterion',
              text: 'The published app starts on a machine without the .NET SDK'
            }
          }
        ],
    risks: [],
    assumptions: ['Durations are fixed for 1.0'],
    warnings: []
  })
}

function projectBrief(): string {
  return JSON.stringify({
    health: 'on-track',
    headline: 'The timer core is planned and the window is next.',
    summary: 'Work is moving in order: skeleton, timer core, window, then settings.',
    nextActions: [
      {
        title: 'Finish the timer state machine',
        rationale: 'The window depends on it.',
        evidence: ['Task list']
      }
    ],
    risks: ['Notification behaviour differs between Windows 10 and 11.'],
    assumptions: ['One developer, part time'],
    warnings: []
  })
}

function decisionDraft(prompt: string): string {
  const evidence = evidenceAfter(prompt, 'Evidence:')
  const ids = JSON.stringify(evidence ?? {}).match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
  )
  return JSON.stringify({
    title: 'Use WinForms on .NET 8 for the window',
    context:
      'The app is one small window with a few buttons, and it must start fast on any Windows 10 or 11 PC.',
    decision:
      'Build the window with WinForms on .NET 8 and keep all timer logic in a separate class library.',
    alternativesConsidered:
      'WPF (heavier for one window), WinUI 3 (packaging overhead), Electron (far too large for a timer).',
    consequences:
      'Small and fast to start. Styling is plain; high-DPI needs PerMonitorV2 in the manifest.',
    linkedWorkItemIds: ids ? [ids[0]] : [],
    rationale: 'Smallest thing that works on every supported Windows.',
    evidence: ['The project brief'],
    assumptions: ['No need for animations'],
    warnings: []
  })
}

function masterPlan(): string {
  return JSON.stringify({
    summary: 'Build the timer from the inside out: core logic first, then the window, then polish.',
    auditFindings: ['No code exists yet beyond the README.'],
    nonNegotiableRules: ['Timer logic stays out of the UI project'],
    phases: [
      { name: 'Skeleton', objective: 'A solution that builds and runs its empty test suite.' },
      { name: 'Timer core', objective: 'A tested state machine for focus and break periods.' },
      { name: 'Window', objective: 'A usable window driving the timer.' }
    ],
    assumptions: ['.NET 8 SDK on the build machine'],
    warnings: []
  })
}

function taskSplit(prompt: string): string {
  const evidence = evidenceAfter(prompt, 'Approved master plan and planning evidence:')
  const phases = (evidence?.phases as { code?: string; name?: string }[] | undefined) ?? []
  return JSON.stringify({
    phases: phases.map((phase) => ({
      code: phase.code ?? 'A',
      name: phase.name ?? 'Phase',
      tasks: [
        {
          title: `${phase.name ?? 'Phase'}: first deliverable`,
          context: 'The repository holds a README and a .gitignore.',
          preconditions: [],
          references: ['README.md: the product summary'],
          task: '1. Create the files this phase needs.\n2. Build.\n3. Commit.',
          deliverables: [
            `docs/${(phase.code ?? 'a').toLowerCase()}-notes.md: what this phase added`
          ],
          constraints: ['Keep timer logic out of the UI project'],
          acceptanceCriteria: ['dotnet build exits with 0'],
          outOfScope: ['Packaging'],
          reliesOn: [],
          priority: 'medium',
          attachments: [],
          subtasks: []
        }
      ]
    }))
  })
}

function libraryGoal(): string {
  return JSON.stringify({
    title: 'Ship Pomodoro Desk 1.0',
    outcome:
      'A small Windows focus timer that anyone can download, start and use without reading a manual.',
    warnings: []
  })
}

function improvement(): string {
  return JSON.stringify({
    title: 'Write the timer state machine with an injected clock',
    description:
      'PomodoroTimer in PomodoroDesk.Core. Phases: Focus (25 min), ShortBreak (5), LongBreak (15 after every 4th focus). Tick() reads time from IClock so tests run instantly.',
    priority: 'high',
    acceptanceCriteria: [
      'Tests cover Focus→ShortBreak, the 4th Focus→LongBreak, Pause and Reset',
      'Core has no WinForms reference'
    ],
    rationale: 'Clearer scope and checkable criteria.',
    assumptions: [],
    warnings: [],
    attachments: []
  })
}

function statusReview(prompt: string): string {
  const evidence = evidenceAfter(prompt, 'Work items and evidence:')
  const items = (JSON.stringify(evidence ?? {}).match(/"workItemId":"([^"]+)"/g) ?? []).map(
    (match) => match.slice(14, -1)
  )
  return JSON.stringify({
    items: [...new Set(items)].map((workItemId) => ({
      workItemId,
      claimedStatus: 'done',
      evidenceAssessment:
        'The session report lists the files and a summary consistent with the task.',
      concerns: [],
      recommendedVerification: 'passed',
      confidence: 'medium'
    }))
  })
}

function taskReview(): string {
  return JSON.stringify({
    diagnosis: 'The work matches the task; nothing downstream is affected.',
    proposal: null,
    downstreamEffects: []
  })
}

function followUp(): string {
  return JSON.stringify({
    title: 'Cover Pause and Resume in the timer tests',
    description: 'Add tests for pausing mid-focus and resuming with the remaining time intact.',
    priority: 'medium',
    acceptanceCriteria: ['A paused timer does not advance', 'Resume continues from the paused time']
  })
}

function projectChat(lastUser: string): string {
  const fence = '```'
  return [
    `Here is where things stand, based on the tasks in this project: the skeleton and timer core come first, then the window. You asked: "${lastUser.slice(0, 120)}".`,
    '',
    'One gap I can see is a task for the tray notification at the end of each period. You can add it:',
    '',
    `${fence}ostler-proposal`,
    JSON.stringify({
      type: 'work_item',
      title: 'Show a tray notification when a period ends',
      description: 'A balloon tip says "Focus done — take a break" or "Break over".',
      priority: 'medium',
      labels: ['ui']
    }),
    fence
  ].join('\n')
}

function classify(request: ChatRequest): { feature: string; answer: () => string } {
  const messages = request.messages ?? []
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => text(m.content))
    .join('\n')
  const user = messages.filter((m) => m.role === 'user').map((m) => text(m.content))
  const prompt = user.join('\n')
  const lastUser = user[user.length - 1] ?? ''
  const has = (needle: string) => prompt.includes(needle)
  if (prompt.trim() === 'hello') return { feature: 'test-connection', answer: () => 'Hello.' }
  if (has('Propose one project goal')) return { feature: 'library-goal', answer: libraryGoal }
  if (has('Break the supplied project goal'))
    return { feature: 'goal-breakdown', answer: goalBreakdown }
  if (has('Recommend exactly five concrete next project tasks'))
    return { feature: 'next-tasks', answer: nextTasks }
  if (has('Assess the milestone'))
    return { feature: 'milestone-review', answer: () => milestoneAdvisory(prompt) }
  if (has('Rewrite the knowledge document'))
    return {
      feature: 'knowledge-rewrite',
      answer: () =>
        (prompt.split('Current knowledge:\n')[1] ?? '').trim() + '\n\n(Revised for clarity.)'
    }
  if (has('Prepare a concise project coordinator brief'))
    return { feature: 'project-brief', answer: projectBrief }
  if (has('revise only this recommendation'))
    return {
      feature: 'recommendation-revision',
      answer: () =>
        JSON.stringify({
          title: 'Clarified recommendation',
          rationale: 'Revised from your notes.',
          evidence: ['Your notes']
        })
    }
  if (has('Improve the supplied')) return { feature: 'improve-task', answer: improvement }
  if (has('Draft an architectural or project decision record'))
    return { feature: 'decision-draft', answer: () => decisionDraft(prompt) }
  if (has('Draft a master execution plan')) return { feature: 'master-plan', answer: masterPlan }
  if (has('Split the supplied approved master plan'))
    return { feature: 'task-split', answer: () => taskSplit(prompt) }
  if (has('auditing the claimed completion status'))
    return { feature: 'status-review', answer: () => statusReview(prompt) }
  if (has('draft exactly one new follow-up work item'))
    return { feature: 'task-review-resolution', answer: followUp }
  if (has('Review one work item')) return { feature: 'task-review', answer: taskReview }
  if (has('Improvement Review'))
    return {
      feature: 'improvement-review',
      answer: () => JSON.stringify({ summary: 'Nothing new.', suggestions: [] })
    }
  if (system.includes('Project Notes chat'))
    return { feature: 'project-chat', answer: () => projectChat(lastUser) }
  return {
    feature: 'chat',
    answer: () =>
      `Pomodoro Desk is on track. The plan has its skeleton, timer core and window milestones in order. (Answer from the monkey's stand-in AI to: "${lastUser.slice(0, 100)}")`
  }
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

/** Streams `content` as OpenAI chat-completion chunks, a few words at a time. */
async function stream(
  response: http.ServerResponse,
  content: string,
  delayMs: number
): Promise<void> {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  const pieces = content.match(/[\s\S]{1,120}/g) ?? ['']
  for (const piece of pieces) {
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece } }] })}\n\n`
    )
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  response.write(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
  )
  response.end('data: [DONE]\n\n')
}

export async function startFakeAi(runDir: string, preferredPort = 0): Promise<FakeAi> {
  const log = path.join(runDir, 'fake-ai-requests.jsonl')
  const counts: Record<string, number> = {}
  let failure: Failure | null = null

  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      void (async () => {
        const url = (request.url ?? '/').split('?')[0]
        if (request.method === 'POST' && url === '/__control') {
          const parsed = JSON.parse(body || '{}') as { failNext?: Failure }
          failure = parsed.failNext ?? null
          send(response, 200, { ok: true, failNext: failure })
          return
        }
        if (request.method === 'GET' && /\/models$/.test(url)) {
          send(response, 200, {
            object: 'list',
            data: [{ id: FAKE_AI_MODEL, object: 'model', owned_by: 'monkey' }]
          })
          return
        }
        if (request.method !== 'POST' || !/chat\/completions$/.test(url)) {
          send(response, 404, {
            error: { message: `The monkey's stand-in AI has no ${request.method} ${url}` }
          })
          return
        }
        let parsed: ChatRequest
        try {
          parsed = JSON.parse(body) as ChatRequest
        } catch {
          send(response, 400, { error: { message: 'Body is not JSON' } })
          return
        }
        const { feature, answer } = classify(parsed)
        counts[feature] = (counts[feature] ?? 0) + 1
        const promptText = (parsed.messages ?? []).map((m) => text(m.content)).join('\n')
        fs.appendFileSync(
          log,
          `${JSON.stringify({
            at: new Date().toISOString(),
            feature,
            model: parsed.model,
            stream: !!parsed.stream,
            messages: parsed.messages?.length ?? 0,
            promptChars: promptText.length,
            includesLibrary: /## Project library|project library/i.test(promptText),
            tools: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
            failure: failure ?? undefined
          })}\n`
        )
        const failing = failure
        failure = null
        if (failing === 'http-500')
          return send(response, 500, {
            error: { message: 'Stand-in AI: internal error (on purpose)' }
          })
        if (failing === 'http-401')
          return send(response, 401, {
            error: { message: 'Stand-in AI: invalid API key (on purpose)' }
          })
        let content = answer()
        if (failing === 'not-json') content = 'Sorry, I cannot help with that.'
        if (failing === 'truncated') content = content.slice(0, Math.floor(content.length / 2))
        if (parsed.stream) await stream(response, content, failing === 'slow' ? 1500 : 0)
        else
          send(response, 200, {
            id: 'monkey',
            object: 'chat.completion',
            model: parsed.model ?? FAKE_AI_MODEL,
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            usage: {
              prompt_tokens: Math.ceil(promptText.length / 4),
              completion_tokens: Math.ceil(content.length / 4)
            }
          })
      })().catch((error) => {
        if (!response.headersSent) send(response, 500, { error: { message: String(error) } })
        else response.end()
      })
    })
  })

  const port = await new Promise<number>((resolve, reject) => {
    const listen = (candidate: number) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (candidate && error.code === 'EADDRINUSE') listen(0)
        else reject(error)
      })
      server.listen(candidate, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') reject(new Error('No address'))
        else resolve(address.port)
      })
    }
    listen(preferredPort)
  })
  fs.writeFileSync(
    path.join(runDir, 'fake-ai.json'),
    JSON.stringify({ port, model: FAKE_AI_MODEL })
  )
  return {
    url: `http://127.0.0.1:${port}/v1`,
    port,
    failNext: (next) => {
      failure = next
    },
    counts: () => ({ ...counts }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** The port a continued run's stand-in AI used, so the app's saved address still works. */
export function previousFakeAiPort(runDir: string): number {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(runDir, 'fake-ai.json'), 'utf8')) as {
      port?: number
    }
    return typeof saved.port === 'number' ? saved.port : 0
  } catch {
    return 0
  }
}
