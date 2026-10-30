import * as fs from 'fs'
import * as path from 'path'
import type { Page } from 'playwright'
import type { MonkeyOptions } from './options'

/**
 * Everything a monkey run leaves behind, written as it happens so a crash
 * keeps what came before it:
 *
 * - `actions.jsonl`: every action the hand took (click, typing, keys), one JSON per line
 * - `keys.log`: every key the app actually received, from the page itself
 * - `console.log`: the renderer's console and uncaught errors
 * - `findings.json`: what was found, deduplicated, with evidence
 * - `journal.md`: the narrative: phases, notes, decisions
 * - `coverage.json`: the screens seen and, per screen, the controls seen and pressed
 * - `shots/`: screenshots, numbered in the order they were taken
 */

/**
 * The user's four questions, then what the monkey detects by itself.
 * broken: not working. hard: hard to do. improve: could be better.
 * feature: missing. The rest are machine-detected.
 */
export const FINDING_KINDS = [
  'broken',
  'hard',
  'improve',
  'feature',
  'docs',
  'error',
  'visual',
  'a11y',
  'perf',
  'dead-click'
] as const
export type FindingKind = (typeof FINDING_KINDS)[number]

/**
 * S1 loses work or capacity; S2 makes Ostler say something untrue; S3 wastes
 * time; S4 is friction and polish.
 */
export type Severity = 'S1' | 'S2' | 'S3' | 'S4'

export type FindingSource = 'monkey' | 'overseer' | 'agent' | 'human'

export interface Finding {
  id: string
  kind: FindingKind
  severity: Severity
  source: FindingSource
  title: string
  details: string
  /** The screen it happened on: route plus the top dialog, if any. */
  where: string
  phase: string
  /** The action number it followed. */
  step: number
  screenshot?: string
  /** How often the same finding recurred. */
  count: number
  firstSeen: string
  lastSeen: string
}

export interface FindingInput {
  kind: FindingKind
  severity: Severity
  title: string
  details?: string
  source?: FindingSource
  where?: string
  /** Same key, same finding: it is counted, not repeated. Defaults to kind + title + where. */
  key?: string
  screenshot?: string
}

export type ActionKind =
  | 'launch'
  | 'click'
  | 'double-click'
  | 'right-click'
  | 'type'
  | 'press'
  | 'select'
  | 'check'
  | 'hover'
  | 'scroll'
  | 'drag'
  | 'wait'
  | 'expect'
  | 'api'
  | 'agent'
  | 'note'
  | 'shot'
  | 'restart'
  | 'phase'

export interface ActionRecord {
  seq: number
  t: string
  elapsedMs: number
  phase: string
  kind: ActionKind
  /** In words: `button "New task" in dialog "New project"`. */
  target?: string
  /** Typed text, already redacted when secret. */
  value?: string
  route?: string
  durationMs: number
  ok: boolean
  error?: string
  screenshot?: string
}

interface ScreenCoverage {
  firstSeen: string
  visits: number
  controls: Record<string, { seen: number; pressed: number }>
}

export interface PhaseRecord {
  name: string
  title: string
  status: 'passed' | 'failed' | 'skipped' | 'running'
  startedAt: string
  endedAt?: string
  durationMs?: number
  reason?: string
}

const REDACTED = '••••••'

export class Recorder {
  readonly dir: string
  readonly shotsDir: string
  readonly startedAt = Date.now()
  phase = 'setup'
  private seq = 0
  private shotSeq = 0
  private readonly findings = new Map<string, Finding>()
  private readonly screens = new Map<string, ScreenCoverage>()
  readonly phases: PhaseRecord[] = []
  /** Strings never written anywhere: the API key, tokens. */
  private readonly secrets = new Set<string>()
  private lastShotPath: string | undefined

  constructor(private readonly options: MonkeyOptions) {
    this.dir = options.runDir
    this.shotsDir = path.join(this.dir, 'shots')
    fs.mkdirSync(this.shotsDir, { recursive: true })
    // A continued run keeps numbering after the last one.
    this.seq = this.countLines('actions.jsonl')
    this.shotSeq = fs.readdirSync(this.shotsDir).length
    const previous = this.readJson<Finding[]>('findings.json') ?? []
    for (const finding of previous) this.findings.set(this.keyOf(finding), finding)
    const coverage = this.readJson<Record<string, ScreenCoverage>>('coverage.json') ?? {}
    for (const [screen, entry] of Object.entries(coverage)) this.screens.set(screen, entry)
  }

  /** Registers a secret: from now on it is replaced wherever it would be logged. */
  secret(value: string | undefined | null): void {
    if (value && value.length >= 4) this.secrets.add(value)
  }

  redact(text: string): string {
    let out = text
    for (const secret of this.secrets) out = out.split(secret).join(REDACTED)
    // Bearer tokens and API-key shapes that were never registered.
    return out
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, `$1${REDACTED}`)
      .replace(/\b(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, `$1${REDACTED}`)
  }

  private file(name: string): string {
    return path.join(this.dir, name)
  }

  private countLines(name: string): number {
    try {
      return fs.readFileSync(this.file(name), 'utf8').split('\n').filter(Boolean).length
    } catch {
      return 0
    }
  }

  private readJson<T>(name: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8')) as T
    } catch {
      return null
    }
  }

  private append(name: string, text: string): void {
    fs.appendFileSync(this.file(name), this.redact(text))
  }

  elapsed(): number {
    return Date.now() - this.startedAt
  }

  get stepNumber(): number {
    return this.seq
  }

  action(record: Omit<ActionRecord, 'seq' | 't' | 'elapsedMs' | 'phase'>): ActionRecord {
    this.seq += 1
    const full: ActionRecord = {
      seq: this.seq,
      t: new Date().toISOString(),
      elapsedMs: this.elapsed(),
      phase: this.phase,
      ...record
    }
    this.append('actions.jsonl', `${JSON.stringify(full)}\n`)
    return full
  }

  /** Lines for keys.log, as the page saw them. */
  keys(lines: string[]): void {
    if (lines.length) this.append('keys.log', `${lines.join('\n')}\n`)
  }

  console(line: string): void {
    this.append('console.log', `${new Date().toISOString()} ${line}\n`)
  }

  journal(text: string): void {
    this.append('journal.md', `${text}\n`)
  }

  /** Takes a screenshot unless the policy says not to; `force` always takes one. */
  async screenshot(
    page: Page,
    label: string,
    { force = false, full = false }: { force?: boolean; full?: boolean } = {}
  ): Promise<string | undefined> {
    if (!force && this.options.shots !== 'all') return undefined
    this.shotSeq += 1
    const safe = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
    const name = `${String(this.shotSeq).padStart(4, '0')}-${safe || 'shot'}.${full ? 'png' : 'jpg'}`
    const target = path.join(this.shotsDir, name)
    try {
      await page.screenshot(
        full ? { path: target, type: 'png' } : { path: target, type: 'jpeg', quality: 72 }
      )
      this.lastShotPath = path.posix.join('shots', name)
      return this.lastShotPath
    } catch {
      return undefined
    }
  }

  get lastScreenshot(): string | undefined {
    return this.lastShotPath
  }

  private keyOf(finding: Pick<Finding, 'kind' | 'title' | 'where'> & { key?: string }): string {
    return finding.key ?? `${finding.kind}|${finding.title}|${finding.where}`
  }

  finding(input: FindingInput): Finding {
    const where = input.where ?? ''
    const key = input.key ?? `${input.kind}|${input.title}|${where}`
    const now = new Date().toISOString()
    const existing = this.findings.get(key)
    if (existing) {
      existing.count += 1
      existing.lastSeen = now
      this.writeFindings()
      return existing
    }
    const finding: Finding = {
      // After the highest so far: a continued run's findings may not be numbered 1 to n.
      id: `F-${String(
        Math.max(0, ...[...this.findings.values()].map((entry) => Number(entry.id.slice(2)) || 0)) +
          1
      ).padStart(3, '0')}`,
      kind: input.kind,
      severity: input.severity,
      source: input.source ?? 'monkey',
      title: this.redact(input.title).slice(0, 200),
      details: this.redact(input.details ?? '').slice(0, 4000),
      where,
      phase: this.phase,
      step: this.seq,
      screenshot: input.screenshot,
      count: 1,
      firstSeen: now,
      lastSeen: now
    }
    this.findings.set(key, finding)
    this.writeFindings()
    this.journal(
      `- **${finding.id}** \`${finding.kind}\` ${finding.severity} — ${finding.title}${finding.screenshot ? ` ([shot](${finding.screenshot}))` : ''}`
    )
    return finding
  }

  allFindings(): Finding[] {
    return [...this.findings.values()]
  }

  private writeFindings(): void {
    fs.writeFileSync(
      this.file('findings.json'),
      this.redact(JSON.stringify(this.allFindings(), null, 2))
    )
  }

  /** Records the controls on a screen, so the report can list what was never pressed. */
  sawScreen(screen: string, controls: string[]): boolean {
    let entry = this.screens.get(screen)
    const isNew = !entry
    if (!entry) {
      entry = { firstSeen: new Date().toISOString(), visits: 0, controls: {} }
      this.screens.set(screen, entry)
    }
    entry.visits += 1
    for (const control of controls) {
      const record = entry.controls[control] ?? { seen: 0, pressed: 0 }
      record.seen += 1
      entry.controls[control] = record
    }
    return isNew
  }

  pressed(screen: string, control: string): void {
    const entry = this.screens.get(screen) ?? {
      firstSeen: new Date().toISOString(),
      visits: 1,
      controls: {}
    }
    const record = entry.controls[control] ?? { seen: 1, pressed: 0 }
    record.pressed += 1
    entry.controls[control] = record
    this.screens.set(screen, entry)
  }

  coverage(): Record<string, ScreenCoverage> {
    return Object.fromEntries(this.screens)
  }

  phaseStart(name: string, title: string): PhaseRecord {
    this.phase = name
    const record: PhaseRecord = {
      name,
      title,
      status: 'running',
      startedAt: new Date().toISOString()
    }
    this.phases.push(record)
    this.journal(`\n## ${title} (\`${name}\`)\n`)
    this.action({ kind: 'phase', target: name, durationMs: 0, ok: true })
    return record
  }

  phaseEnd(record: PhaseRecord, status: PhaseRecord['status'], reason?: string): void {
    record.status = status
    record.endedAt = new Date().toISOString()
    record.durationMs = Date.parse(record.endedAt) - Date.parse(record.startedAt)
    if (reason) record.reason = this.redact(reason)
    this.journal(
      `\n_${status}${reason ? `: ${this.redact(reason)}` : ''} (${Math.round((record.durationMs ?? 0) / 1000)} s)_`
    )
    this.flush()
  }

  flush(): void {
    this.writeFindings()
    fs.writeFileSync(this.file('coverage.json'), JSON.stringify(this.coverage(), null, 2))
    fs.writeFileSync(this.file('phases.json'), JSON.stringify(this.phases, null, 2))
  }
}
