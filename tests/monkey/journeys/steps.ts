import * as fs from 'fs'
import * as path from 'path'
import type { OstlerAPI } from '../../../src/shared/ostler-api'
import { StepError, type Session } from '../lib/session'
import type { PhaseContext } from './phases'

/** The steps every journey is made of: what a person does, and how the monkey checks it. */

export const SAMPLE_PROJECT = 'Welcome to Ostler (Demo Project)'

export function day(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

export function conventionsText(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../../dummy-project/agent-conventions.md'),
    'utf8'
  )
}

/**
 * One step inside a phase. If it fails, the failure becomes a finding with
 * its screenshot and the phase moves on: the next step usually does not
 * depend on this one, and a person would try the next thing too.
 */
export async function attempt(
  context: PhaseContext,
  label: string,
  work: () => Promise<void>,
  severity: 'S2' | 'S3' = 'S3',
  { recover = true }: { recover?: boolean } = {}
): Promise<boolean> {
  const { session } = context
  try {
    await work()
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    const shot =
      error instanceof StepError && error.screenshot
        ? error.screenshot
        : await session.recorder.screenshot(session.page, `failed-${label}`, { force: true })
    session.recorder.finding({
      kind: 'broken',
      severity,
      title: `${label}: ${message}`.slice(0, 200),
      details:
        'A step a person would take did not work. Either Ostler is wrong here, or the screen changed ' +
        'and the journey needs updating (tests/monkey/journeys/dummy-app.ts). The screenshot shows which.\n\n' +
        (error instanceof Error ? (error.stack ?? message) : message),
      where: await session.screen(),
      screenshot: shot,
      key: `step|${label}`
    })
    // Back out of whatever is half open, as a person would; not inside a
    // dialog the next steps still need.
    if (recover) {
      await session.page.keyboard.press('Escape').catch(() => {})
      await session.page.waitForTimeout(150).catch(() => {})
      await session.page.keyboard.press('Escape').catch(() => {})
    }
    return false
  }
}

/** Records a finding when what Ostler shows or stores is not what it should be. */
export function verify(
  context: PhaseContext,
  ok: boolean,
  title: string,
  details: string,
  severity: 'S1' | 'S2' | 'S3' | 'S4' = 'S2'
): void {
  context.session.recorder.journal(`- check: ${ok ? 'ok' : 'FAILED'} — ${title}`)
  if (ok) return
  context.session.recorder.finding({
    kind: 'broken',
    severity,
    title,
    details,
    where: 'state check',
    key: `verify|${title}`
  })
}

/** A note about friction a person would feel, recorded as it is noticed. */
export function friction(
  context: PhaseContext,
  kind: 'hard' | 'improve' | 'feature' | 'docs',
  severity: 'S2' | 'S3' | 'S4',
  title: string,
  details: string
): void {
  context.session.recorder.finding({
    kind,
    severity,
    title,
    details,
    where: 'journey',
    key: `friction|${title}`
  })
}

export async function projects(
  session: Session
): Promise<{ id: string; name: string; path: string | null }[]> {
  return session.api(
    'list projects',
    async () => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const result = await api.getProjects()
      if (!result.ok) throw new Error(result.error)
      return result.value.map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path
      }))
    },
    null
  )
}

export interface ItemSummary {
  id: string
  title: string
  status: string
  milestoneId: string | null
  dependencyIds: string[]
  assigneeId?: string | null
  targetDate?: string | null
  labels: string[]
}

export async function workItems(session: Session, projectId: string): Promise<ItemSummary[]> {
  return session.api(
    'list tasks',
    async (id: string) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const result = await api.getPlanningWorkItems(id)
      if (!result.ok) throw new Error(result.error)
      return result.value.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        milestoneId: item.milestoneId,
        dependencyIds: item.dependencyIds,
        assigneeId: (item as { assigneeId?: string | null }).assigneeId ?? null,
        targetDate: item.targetDate ?? null,
        labels: item.labels
      }))
    },
    projectId
  )
}

export interface HarnessSummary {
  queue: { id: string; title: string; status: string; planningWorkItemId: string | null }[]
  active: { id: string; title: string; status: string; provenance: string }[]
  review: { id: string; title: string; taskId: string | null }[]
  questions: { id: string; status: string; question: string }[]
}

export async function harness(session: Session, projectId: string): Promise<HarnessSummary> {
  return session.api(
    'read agent state',
    async (id: string) => {
      const api = (globalThis as unknown as { ostlerAPI: OstlerAPI }).ostlerAPI
      const result = await api.getHarnessState(id)
      if (!result.ok) throw new Error(result.error)
      const state = result.value
      return {
        queue: state.taskQueue.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          planningWorkItemId: task.planningWorkItemId ?? null
        })),
        active: state.activeSessions.map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          provenance: String(s.provenance)
        })),
        review: state.reviewSessions.map((s) => ({
          id: s.id,
          title: s.title,
          taskId: s.taskId ?? null
        })),
        questions: state.questions.map((q) => ({
          id: q.id,
          status: q.status,
          question: q.question
        }))
      }
    },
    projectId
  )
}

export async function openProject(session: Session, name: string): Promise<void> {
  const { ui, hand } = session
  await hand.click(ui.region('Projects').link(name))
  await hand.expect(ui.heading(name), 10_000)
}

/** Opens a project tab. Matched by its start: "Agents" also reads "Agents 1 running or to review". */
export async function openTab(session: Session, name: string): Promise<void> {
  const { ui, hand } = session
  const tab = ui.tab(new RegExp(`^${name}(?![A-Za-z])`))
  await hand.click(tab)
  await hand.expect(tab, 5000)
}

/** Opens a project view: its tab when it has one, otherwise from More views (Archive, Recycle bin). */
export async function openView(session: Session, name: string): Promise<void> {
  const { ui, hand } = session
  if (await hand.sees(ui.tab(new RegExp(`^${name}(?![A-Za-z])`)), 500)) {
    await openTab(session, name)
    return
  }
  await hand.click(ui.button(/^More views/, false))
  await hand.click(ui.menuitem(name))
}

export async function openSettings(session: Session, section: string): Promise<void> {
  const { ui, hand } = session
  await hand.click(ui.link('Settings'))
  const sections = ui.within(
    session.page.getByRole('navigation', { name: 'Settings sections' }),
    'the settings sections'
  )
  await hand.click(sections.link(section))
  await hand.expect(ui.heading(section), 8000)
}

/** Opens a task's drawer from the Board. */
export async function openTask(session: Session, title: string): Promise<void> {
  const { ui, hand } = session
  await hand.click(ui.button(`Open ${title}`))
  await hand.expect(ui.dialog(title).heading(title), 8000)
}

/** Polls until `ready` says yes, for at most `minutes`; the wait is recorded. */
export async function waitUntil(
  session: Session,
  reason: string,
  minutes: number,
  ready: () => Promise<boolean>
): Promise<boolean> {
  const deadline = Date.now() + minutes * 60_000
  let waited = 0
  while (Date.now() < deadline) {
    if (await ready()) {
      if (waited) session.recorder.journal(`- waited ${Math.round(waited / 1000)} s: ${reason}`)
      return true
    }
    await session.page.waitForTimeout(3000)
    waited += 3000
  }
  session.recorder.journal(`- gave up after ${minutes} min: ${reason}`)
  return false
}
