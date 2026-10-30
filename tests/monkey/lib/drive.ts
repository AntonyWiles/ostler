import * as fs from 'fs'
import * as http from 'node:http'
import * as path from 'path'
import { queueOpenFile, readClipboard } from './app'
import type { FakeAi } from './fake-ai'
import { FINDING_KINDS, type FindingKind, type Severity } from './recorder'
import { writeReport } from './report'
import {
  resolveTarget as resolveLocator,
  StepError,
  type AriaRole,
  type Session,
  type Target,
  type Ui
} from './session'

/**
 * Drive mode: the app stays open and a loopback HTTP server takes commands,
 * so an AI overseer (or a person with curl) can use Ostler through its screen
 * with everything recorded exactly as a scripted run is: the action log, the
 * key log, a screenshot per action, the automatic checks, and notes.
 *
 *   curl -s http://127.0.0.1:<port>/                 the command list
 *   curl -s http://127.0.0.1:<port>/snapshot         what is on screen, as text
 *   curl -s -X POST http://127.0.0.1:<port>/click -d '{"role":"button","name":"New task"}'
 *
 * Commands run one at a time, in the order they arrive.
 */

const HELP = `Ostler monkey: drive mode. Every command is recorded, screenshotted and checked.
Targets (in a JSON body): {"role":"button","name":"Save"} | {"label":"Title"} | {"text":"Some words"} | {"id":12}
  ids come from GET /controls. Add "exact":false for a partial name, "nth":2 for the third match,
  and "within":{"dialog":"New task"} or {"region":"Board"} to look inside one part of the screen.

GET  /                 this help
GET  /state            screen, title, open dialogs, toasts, focused control, step count
GET  /snapshot         the screen as an accessibility tree (YAML); ?dialog=1 for the top dialog only
GET  /controls         visible controls with ids, roles, names and whether they are disabled
GET  /text             the window's visible text
GET  /findings         findings so far
GET  /clipboard        what Ostler last copied (prompts with tokens are redacted in logs)
POST /click            target + {"button":"right"} or {"double":true}
POST /fill             target + {"value":"text"} (+ "secret":true to keep it out of logs, "append":true)
POST /type             {"text":"typed into whatever has focus"}
POST /press            {"keys":"Control+K"} (+ "times":3)
POST /select           target + {"option":"value or label"}
POST /check            target + {"checked":true|false}
POST /hover            target
POST /scroll           {"dy":600} (+ target to scroll inside)
POST /drag             {"from":target,"to":target}
POST /wait             {"ms":2000,"reason":"waiting for the agent"}
POST /stability        target: watches a control for 3 s and says how often it was replaced or moved
POST /shot             {"label":"what this shows"}
POST /note             {"kind":"broken|hard|improve|feature|docs","severity":"S1-S4","title":"...","details":"..."}
POST /journal          {"text":"a line for the narrative"}
POST /open-file        {"paths":["C:\\\\path\\\\file.csv"]}: the next file picker answers with these
POST /ai-fail          {"failNext":"http-500|http-401|not-json|truncated|slow"} (stand-in AI only)
POST /restart          {"reason":"why"}: close Ostler and start it again on the same data
POST /report           write report.md and report.html now
POST /quit             write the report, close Ostler and end the run`

interface TargetSpec {
  role?: string
  name?: string
  label?: string
  text?: string
  id?: number
  exact?: boolean
  nth?: number
  within?: { dialog?: string; region?: string }
}

function resolveTarget(session: Session, spec: TargetSpec): Target {
  let ui: Ui = session.ui
  if (spec.within?.dialog) ui = ui.dialog(spec.within.dialog)
  else if (spec.within?.region) ui = ui.region(spec.within.region)
  const exact = spec.exact ?? true
  const nth = spec.nth ?? 0
  if (typeof spec.id === 'number') {
    return {
      locator: session.page.locator(`[data-monkey-id="${spec.id}"]`),
      description: `control #${spec.id}`
    }
  }
  if (spec.role && spec.name !== undefined)
    return ui.role(spec.role as AriaRole, spec.name, exact, nth)
  if (spec.label !== undefined) return ui.label(spec.label, exact, nth)
  if (spec.text !== undefined) return ui.text(spec.text, exact, nth)
  throw new Error('A target needs "id", "role" and "name", "label", or "text"')
}

async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of request) body += chunk
  if (!body.trim()) return {}
  return JSON.parse(body) as Record<string, unknown>
}

export interface DriveServer {
  url: string
  /** Resolves when the overseer asks to quit. */
  done: Promise<void>
  close(): Promise<void>
}

export async function startDriveServer(
  session: Session,
  fakeAi: FakeAi | null
): Promise<DriveServer> {
  const { recorder, options } = session
  let queue: Promise<unknown> = Promise.resolve()
  let finish: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })

  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work)
    queue = next.catch(() => {})
    return next
  }

  const answer = async (spec: Record<string, unknown>, act: () => Promise<void>) => {
    const before = recorder.allFindings().length
    await act()
    const findings = recorder.allFindings()
    return {
      ok: true,
      screen: await session.screen(),
      step: recorder.stepNumber,
      screenshot: recorder.lastScreenshot,
      newFindings: findings.slice(before).map((f) => `${f.id} ${f.severity} ${f.kind}: ${f.title}`),
      ...(spec.debug ? { spec } : {})
    }
  }

  const routes: Record<
    string,
    (body: Record<string, unknown>, query: URLSearchParams) => Promise<unknown>
  > = {
    'GET /': async () => HELP,
    'GET /state': async () => {
      const page = session.page
      const state = await page.evaluate(() => {
        const visible = (element: Element) => (element as HTMLElement).getClientRects().length > 0
        const names = (selector: string) =>
          Array.from(document.querySelectorAll(selector))
            .filter(visible)
            .map(
              (element) =>
                element.getAttribute('aria-label') ||
                (element.textContent ?? '').trim().slice(0, 80)
            )
        const w = window as unknown as { __monkeyDescribe?: (element: Element | null) => string }
        return {
          title: document.title,
          route: location.hash,
          dialogs: names('[role=dialog], [role=alertdialog]'),
          toasts: Array.from(document.querySelectorAll('.ui-toast')).map((toast) =>
            (toast.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
          ),
          focused: w.__monkeyDescribe?.(document.activeElement) ?? ''
        }
      })
      return { screen: await session.screen(), step: recorder.stepNumber, ...state }
    },
    'GET /snapshot': async (_body, query) => {
      const page = session.page
      const dialog = page.locator('[role=dialog]:visible, [role=alertdialog]:visible').last()
      const root = query.get('dialog') && (await dialog.count()) > 0 ? dialog : page.locator('body')
      return root.ariaSnapshot({ timeout: 10_000 })
    },
    'GET /controls': async () =>
      session.page.evaluate(() => {
        const w = window as unknown as {
          __monkeyInventory?: (
            tag: boolean
          ) => { id: number; role: string; name: string; disabled: boolean }[]
        }
        return w.__monkeyInventory?.(true) ?? []
      }),
    'GET /text': async () => session.page.evaluate(() => document.body.innerText.slice(0, 50_000)),
    'GET /findings': async () => recorder.allFindings(),
    'GET /clipboard': async () => recorder.redact(await readClipboard(session.app)),
    'POST /click': async (body) =>
      answer(body, () =>
        session.hand.click(resolveTarget(session, body as TargetSpec), {
          button: body.button === 'right' ? 'right' : 'left',
          double: body.double === true,
          deadClickCheck: true
        })
      ),
    'POST /fill': async (body) =>
      answer(body, () =>
        session.hand.fill(resolveTarget(session, body as TargetSpec), String(body.value ?? ''), {
          secret: body.secret === true,
          append: body.append === true
        })
      ),
    'POST /type': async (body) => answer(body, () => session.hand.type(String(body.text ?? ''))),
    'POST /press': async (body) =>
      answer(body, () =>
        session.hand.press(String(body.keys ?? ''), {
          times: typeof body.times === 'number' ? body.times : 1
        })
      ),
    'POST /select': async (body) =>
      answer(body, () =>
        session.hand.select(resolveTarget(session, body as TargetSpec), String(body.option ?? ''))
      ),
    'POST /check': async (body) =>
      answer(body, () =>
        session.hand.check(resolveTarget(session, body as TargetSpec), body.checked !== false)
      ),
    'POST /hover': async (body) =>
      answer(body, () => session.hand.hover(resolveTarget(session, body as TargetSpec))),
    'POST /scroll': async (body) =>
      answer(body, () =>
        session.hand.scroll(
          body.role || body.label || body.text || body.id
            ? resolveTarget(session, body as TargetSpec)
            : null,
          Number(body.dy ?? 400)
        )
      ),
    'POST /drag': async (body) =>
      answer(body, () =>
        session.hand.drag(
          resolveTarget(session, body.from as TargetSpec),
          resolveTarget(session, body.to as TargetSpec)
        )
      ),
    'POST /wait': async (body) =>
      answer(body, () =>
        session.hand.wait(
          String(body.reason ?? 'waiting'),
          Math.min(Number(body.ms ?? 1000), 600_000)
        )
      ),
    'POST /shot': async (body) => ({
      path: await session.hand.shot(String(body.label ?? 'overseer'))
    }),
    'POST /stability': async (body) => {
      // A control that is replaced or moves while a person reaches for it
      // eats clicks and loses keyboard focus. Mark it, then keep looking.
      const target = resolveTarget(session, body as TargetSpec)
      const locator = await resolveLocator(session.page, target)
      const marker = `monkey-${Date.now()}`
      await locator.evaluate(
        (element, mark) => element.setAttribute('data-monkey-stable', mark),
        marker
      )
      const first = await locator.boundingBox()
      let replaced = 0
      let moved = 0
      let current = marker
      for (let sample = 0; sample < 30; sample += 1) {
        await session.page.waitForTimeout(100)
        const seen = await locator
          .evaluate((element) => element.getAttribute('data-monkey-stable'))
          .catch(() => null)
        if (seen !== current) {
          replaced += 1
          current = `monkey-${Date.now()}-${sample}`
          await locator
            .evaluate((element, mark) => element.setAttribute('data-monkey-stable', mark), current)
            .catch(() => {})
        }
        const box = await locator.boundingBox().catch(() => null)
        if (first && box && (Math.abs(box.x - first.x) > 1 || Math.abs(box.y - first.y) > 1))
          moved += 1
      }
      return {
        target: target.description,
        replacedTimes: replaced,
        movedSamples: moved,
        samples: 30,
        overMs: 3000
      }
    },
    'POST /note': async (body) => {
      const kind = String(body.kind ?? 'improve') as FindingKind
      if (!FINDING_KINDS.includes(kind))
        throw new Error(`kind must be one of ${FINDING_KINDS.join(', ')}`)
      const severity = String(body.severity ?? 'S3') as Severity
      if (!['S1', 'S2', 'S3', 'S4'].includes(severity))
        throw new Error('severity must be S1, S2, S3 or S4')
      const screen = await session.screen()
      const shot = await recorder.screenshot(session.page, `note-${String(body.title ?? '')}`, {
        force: true
      })
      const finding = recorder.finding({
        kind,
        severity,
        source: body.source === 'human' || body.source === 'agent' ? body.source : 'overseer',
        title: String(body.title ?? 'Untitled note'),
        details: String(body.details ?? ''),
        where: String(body.where ?? screen),
        screenshot: shot,
        key: `note|${Date.now()}`
      })
      return { ok: true, id: finding.id, screenshot: shot }
    },
    'POST /journal': async (body) => {
      recorder.journal(String(body.text ?? ''))
      return { ok: true }
    },
    'POST /open-file': async (body) => {
      const paths = Array.isArray(body.paths) ? body.paths.map(String) : []
      for (const file of paths) if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`)
      await queueOpenFile(session.app, paths)
      recorder.journal(`- The next file picker answers with ${paths.join(', ')}`)
      return { ok: true }
    },
    'POST /ai-fail': async (body) => {
      if (!fakeAi) throw new Error('This run uses no stand-in AI')
      fakeAi.failNext(String(body.failNext ?? 'http-500') as Parameters<FakeAi['failNext']>[0])
      return { ok: true }
    },
    'POST /restart': async (body) => {
      await session.restart(String(body.reason ?? 'overseer restart'))
      return { ok: true, screen: await session.screen() }
    },
    'POST /report': async () => ({
      path: writeReport(options, recorder, { fakeAi: fakeAi?.counts() })
    }),
    'POST /quit': async () => {
      setTimeout(() => finish(), 50)
      return { ok: true }
    }
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const key = `${request.method} ${url.pathname.replace(/\/$/, '') || '/'}`
    const handler = routes[key]
    void (async () => {
      if (!handler) {
        response.writeHead(404, { 'Content-Type': 'text/plain' })
        response.end(`No ${key}.\n\n${HELP}`)
        return
      }
      try {
        const body = request.method === 'POST' ? await readBody(request) : {}
        const result = await run(() => handler(body, url.searchParams))
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        response.writeHead(200, {
          'Content-Type':
            typeof result === 'string' ? 'text/plain; charset=utf-8' : 'application/json'
        })
        response.end(recorder.redact(text))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        response.writeHead(error instanceof StepError ? 422 : 400, {
          'Content-Type': 'application/json'
        })
        response.end(
          JSON.stringify({
            ok: false,
            error: recorder.redact(message),
            screen: await session.screen().catch(() => 'unknown'),
            screenshot: error instanceof StepError ? error.screenshot : undefined
          })
        )
      }
    })()
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.drivePort, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('No address'))
      else resolve(address.port)
    })
  })
  const url = `http://127.0.0.1:${port}`
  fs.writeFileSync(
    path.join(options.runDir, 'drive.json'),
    JSON.stringify({ url, pid: session.running?.pid, startedAt: new Date().toISOString() }, null, 2)
  )
  recorder.journal(`- Drive mode listening on ${url}`)
  return {
    url,
    done,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
