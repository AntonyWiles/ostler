import { PERSONAL_PIN_PROJECT } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { respondJson } from '../loopback-http'
import { planningChanged, planningOf } from './common'
import type { AutomationRouteDef, RouteCall } from './route-table'

/** The pins service, after checking `:pinId` is this project's pin. */
function ownPins(call: RouteCall) {
  const pins = planningOf(call.server).pins
  const pin = pins.get(call.params.pinId!)
  // A goal of one's own's pin (N5.6b) belongs to no project: every token may change it.
  if (pin.projectId !== call.project.id && pin.kind !== 'personal-goal')
    throw new Refusal('Pin not found')
  return pins
}

/** The status updates service, after checking `:updateId` is this project's update. */
function ownUpdates(call: RouteCall) {
  const updates = planningOf(call.server).statusUpdates
  if (updates.get(call.params.updateId!).projectId !== call.project.id)
    throw new Refusal('Status update not found')
  return updates
}

/** Pins, and status updates (N5.5) posted as the automation API, through the app's own services. */
export const PINS_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/pins',
    description:
      'List this project\'s pins: its Overview\'s shortcuts (place: overview) and the person\'s sidebar pins that point at this project\'s items (place: sidebar), each in its own order. A pin is a pointer: title is the target\'s current title, read now; a pin whose target is gone (deleted or binned) is left out, and comes back if the target is restored; archived: true means the target is archived. A project view\'s title is null (the app names it from targetId). Countdowns: countdown is true while the pin shows as a countdown on Home, in the tray menu and in the jump list; a task or milestone pin also carries date (the due or target date, or null), done, and countdownText, the countdown in the app\'s own words for today\'s local date ("12 days to Launch", "Launch is tomorrow", "Launch is today", "Launch was 2 days ago", "Launch: done", with "(9 working days)" after a gap of more than a week whose working days differ; the working days are your own: the working days of Me, less the days off of Me and of everyone, or Monday to Friday less the days off of everyone with nobody as Me), null while it is not a countdown. personal lists the sidebar pins of goals of your own (kind personal-goal, projectId ""), which belong to no project: their date is the measure\'s target date and done is true once the goal is achieved or dropped.',
    response:
      '{ ok: true, value: { overview: PinView[], sidebar: PinView[], personal: PinView[] } } (PinView: { id, place, projectId, kind, targetId, orderKey, createdAt, countdown, exists, title, archived, status?, libraryKind?, url?, viewType?, date?, done?, countdownText? }; date, done and countdownText only on task, milestone and personal-goal pins)',
    handler: ({ server, res, project }) => {
      const pins = planningOf(server).pins
      respondJson(res, 200, {
        ok: true,
        value: {
          overview: pins.list({ place: 'overview', projectId: project.id }),
          sidebar: pins.list({ place: 'sidebar', projectId: project.id }),
          personal: pins.list({ place: 'sidebar' }).filter((pin) => pin.kind === 'personal-goal')
        }
      })
    }
  },
  {
    method: 'POST',
    path: '/pins',
    description:
      "Pin one of this project's items, as Pin to sidebar and Pin to Overview do in the app. kind is task, milestone, decision, library (a Library item), saved-view or project-view (targetId is the view's id: overview, board, list, calendar, timeline, milestones, library, decisions…), or personal-goal (a goal of your own from GET /personal-goals, sidebar only). Pinning what is already pinned in that place returns the pin that is there. The sidebar holds at most 20 pins; a 21st is refused. New pins go at the end.",
    request:
      'JSON body: { place: "sidebar" | "overview", kind: "task" | "milestone" | "decision" | "library" | "saved-view" | "project-view" | "personal-goal", targetId: string }',
    response: '{ ok: true, value: PinView }',
    exampleBody: { place: 'overview', kind: 'library', targetId: '<library-item-id>' },
    handler: (call) => {
      const { place, kind, targetId } = call.body
      planningChanged(
        call,
        'POST pin',
        planningOf(call.server).pins.create({
          place: place as never,
          kind: kind as never,
          targetId: targetId as never,
          projectId: kind === 'personal-goal' ? PERSONAL_PIN_PROJECT : call.project.id
        })
      )
    }
  },
  {
    method: 'DELETE',
    path: '/pins/:pinId',
    description: 'Unpin. The item the pin pointed at is not changed.',
    response: '{ ok: true, value: Pin } (what was unpinned)',
    handler: (call) => planningChanged(call, 'DELETE pin', ownPins(call).delete(call.params.pinId!))
  },
  {
    method: 'PATCH',
    path: '/pins/:pinId',
    description:
      "Turn a pin's countdown on or off, as Show as countdown and Stop the countdown do in the app. Only a pin of a milestone with a target date, a task with a due date or a goal of your own whose measure has a target date can count down. At most 3 items count down at once, across every project: turning on a fourth is refused unless replacePinId names one of the three to turn off in the same change. Turning a countdown off turns it off for the item in both places it may be pinned.",
    request: 'JSON body: { countdown: boolean, replacePinId?: string }',
    response: '{ ok: true, value: PinView } (with countdownText while it counts down)',
    exampleBody: { countdown: true },
    handler: (call) => {
      const pins = ownPins(call)
      const { countdown, replacePinId } = call.body
      if (typeof countdown !== 'boolean') throw new Refusal('countdown must be true or false')
      if (replacePinId !== undefined && typeof replacePinId !== 'string')
        throw new Refusal('replacePinId must be a pin id')
      planningChanged(
        call,
        'PATCH pin',
        pins.setCountdown(call.params.pinId!, { countdown, replacePinId })
      )
    }
  },
  {
    method: 'POST',
    path: '/pins/:pinId/move',
    description:
      "Move a pin before or after another pin of the same place (the sidebar, or this project's Overview). With neither, it moves to the end.",
    request: 'JSON body: { beforeId?: string, afterId?: string } (not both)',
    response: '{ ok: true, value: PinView }',
    exampleBody: { beforeId: '<pin-id>' },
    handler: (call) => {
      const pins = ownPins(call)
      const { beforeId, afterId } = call.body
      for (const [name, field] of [
        ['beforeId', beforeId],
        ['afterId', afterId]
      ] as const) {
        if (field !== undefined && typeof field !== 'string')
          throw new Refusal(`${name} must be a pin id`)
      }
      planningChanged(
        call,
        'POST pin',
        pins.move(call.params.pinId!, {
          beforeId: beforeId as string | undefined,
          afterId: afterId as string | undefined
        })
      )
    }
  },
  {
    method: 'GET',
    path: '/updates',
    description:
      "List this project's status updates, newest first: the person's own word on how the project is going (health on-track, at-risk or off-track) with a Markdown note. The first is the latest, which the Overview and Home show. authorKind is human (authorPersonId names the person) or automation; authorName is already named. Health is never computed by Ostler.",
    response:
      '{ ok: true, value: StatusUpdate[] } (StatusUpdate: { id, projectId, health, note, authorKind, authorPersonId, authorName, postedAt, editedAt })',
    handler: ({ server, res, project }) =>
      respondJson(res, 200, { ok: true, value: planningOf(server).statusUpdates.list(project.id) })
  },
  {
    method: 'POST',
    path: '/updates',
    description:
      'Post a status update, as Post an update does in the app; it is posted by the automation API, shows on the Overview and Home at once, and records an activity entry. The note is Markdown, trimmed, at most 2000 characters (longer is HTTP 400); it may be empty.',
    request: 'JSON body: { health: "on-track" | "at-risk" | "off-track", note: string }',
    response: '{ ok: true, value: StatusUpdate }',
    exampleBody: {
      health: 'at-risk',
      note: 'Design review slipped a week; launch date holds for now.'
    },
    handler: (call) =>
      planningChanged(
        call,
        'POST status update',
        planningOf(call.server).statusUpdates.post(call.project.id, call.body, {
          kind: 'automation'
        })
      )
  },
  {
    method: 'PATCH',
    path: '/updates/:updateId',
    description:
      "Change a status update's health and note. It keeps its author and posting time; editedAt is set.",
    request: 'JSON body: { health, note } (both, as for POST)',
    response: '{ ok: true, value: StatusUpdate }',
    exampleBody: { health: 'on-track', note: 'Back on track after the review.' },
    handler: (call) =>
      planningChanged(
        call,
        'PATCH status update',
        ownUpdates(call).edit(call.params.updateId!, call.body).after
      )
  },
  {
    method: 'DELETE',
    path: '/updates/:updateId',
    description:
      "Delete a status update. The app's Undo can bring it back; through the API it is gone from every list.",
    response: '{ ok: true, value: StatusUpdate } (what was deleted)',
    handler: (call) =>
      planningChanged(call, 'DELETE status update', ownUpdates(call).delete(call.params.updateId!))
  }
]
