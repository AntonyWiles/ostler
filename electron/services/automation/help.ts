import type { AutomationRoute } from './route-table'

/** The longest summary a route gets in the short list. */
const SUMMARY_LENGTH = 140

/**
 * A route's first sentence, cut to fit one line: what the short list shows.
 * A sentence ends at `. ` followed by anything but a small letter, so
 * "e.g. the" inside a sentence does not end it early.
 */
export function routeSummary(description: string): string {
  const first = /^(.+?[.!?])(?=\s+[^\sa-z])/s.exec(description)?.[1] ?? description
  const line = first.replace(/\s+/g, ' ').trim()
  return line.length <= SUMMARY_LENGTH ? line : `${line.slice(0, SUMMARY_LENGTH - 1).trimEnd()}…`
}

/** Whether a route's `:param` pattern covers a path as sent (`/work-items/BRI-3` is under `/work-items/:workItemId`). */
function pathMatches(pattern: string, path: string): boolean {
  const want = pattern.split('/').filter(Boolean)
  const got = path.split('/').filter(Boolean)
  if (want.length !== got.length) return false
  return want.every((part, index) => part === got[index] || part.startsWith(':'))
}

/** The rules that hold for every route, said once here rather than in each route's text. */
function conventions(): string[] {
  return [
    "Task IDs: every route that takes :workItemId also takes the task's ID, such as BRI-26 (this project's prefix and the task's number), and so do dependencyIds and parentWorkItemId in bodies.",
    'Lists: GET /work-items?status=blocked,ready keeps those statuses; ?fields=key,title,status sends only those fields of each task (id is always sent).',
    'Many changes at once: PATCH /work-items/batch with { items: [{ id, ...fields }] }, one transaction.',
    'Owner only: a task with ownerOnly: true is for the person, not an agent. Agents never queue, claim or work on it; automation may set ownerOnly: true but only the person can clear it, in Ostler.',
    'Blocked: a blocked task can say why in blockedReason (up to 200 characters, such as "Waiting on you" or "Waiting on 1 March"); it clears when the task leaves Blocked. GET /blocked lists blocked tasks and says which have nothing left to wait on.',
    "Links in texts: write a task's ID (BRI-26) and Ostler links it; link a file in the project's folder as ostler://file/<projectId>/<path>, for example ostler://file/<projectId>/docs/plan.md. Links to this computer (http://localhost:…, 127.0.0.1) are kept as text, not links, because the person reading the task cannot open your local servers.",
    'Attachments: POST /work-items/:workItemId/attachments with { fileName, mimeType, base64 } uploads a file to the Library and attaches it in one call; with { itemId } it attaches a Library item already there.'
  ]
}

/**
 * GET /help: short by default, one line per route, because the full
 * text of every route is far more than a caller needs to find one.
 * `?route=<path>` (a pattern or a path as sent) gives the full text of the
 * routes at that path, `&method=` narrows it to one; `?q=<words>` keeps the
 * routes whose path or text holds every word; `?full=1` is everything.
 */
export function buildHelp(
  projectId: string,
  routes: readonly AutomationRoute[],
  query: URLSearchParams
): unknown {
  const instructions = `Ostler automation API for project ${projectId}. Responses use { ok: true, value } or { ok: false, error }. Send Authorization: Bearer <automation token> on every call but this one. This answer lists each route in one line; GET /help?route=<path> gives a route's full text (request body, response, example), for example GET /help?route=/work-items/:workItemId&method=PATCH. GET /help?q=<words> searches the routes, and GET /help?full=1 is every route in full. A project can live only in Ostler, with no folder linked (hasFolder: false in GET /projects). Then the routes that need its folder (queuing tasks for agents, starting embedded sessions, applying a task's work) answer HTTP 409 with a message saying the project needs a linked folder; planning and Library routes keep working. Only the human can link a folder, in Ostler.`
  const full = query.get('full')
  if (full === '1' || full === 'true') return { instructions, conventions: conventions(), routes }
  const routePath = query.get('route')
  if (routePath) {
    const method = query.get('method')?.toUpperCase()
    const found = routes.filter(
      (route) => pathMatches(route.path, routePath) && (!method || route.method === method)
    )
    return { instructions, conventions: conventions(), routes: found }
  }
  const words = (query.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const kept = words.length
    ? routes.filter((route) => {
        const text = `${route.method} ${route.path} ${route.description}`.toLowerCase()
        return words.every((word) => text.includes(word))
      })
    : routes
  return {
    instructions,
    conventions: conventions(),
    routes: kept.map((route) => ({
      method: route.method,
      path: route.path,
      summary: routeSummary(route.description)
    }))
  }
}
