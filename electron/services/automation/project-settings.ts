import type { ProjectAutoDispatchConfig, WatchedProject } from '@shared/ostler-api'
import { isProjectIcon, PROJECT_ICONS } from '@shared/project-icons'
import { isProjectStage, normalizeProjectStage, PROJECT_STAGES } from '@shared/project-stages'
import { projectLessons } from '@shared/project-lessons'
import { Refusal } from '@shared/refusal'
import { normalizeUpdateReminder, type UpdateReminder } from '@shared/status-updates'
import type { AutomationHttpServer } from '../automation-http-server'
import { respondJson } from '../loopback-http'
import { acceptAllFromTriage, triageOn } from '../triage-service'
import { AUTOMATION_ACTOR } from './common'
import type { AutomationRouteDef } from './route-table'

/** The settings PATCH /auto-dispatch takes; typed so a removed setting cannot linger here. */
const AUTO_DISPATCH_FIELDS = [
  'enabled',
  'maxConcurrentEmbeddedSessions',
  'aiOverrideEnabled',
  'defaultProvider',
  'defaultModel',
  'defaultEffort',
  'autoArchiveDoneAfterDays',
  'agentsPlanFirst',
  'reviewBeforeMe'
] as const satisfies readonly (keyof ProjectAutoDispatchConfig)[]

/** How many of the project's tasks wait in To triage. */
function triageWaiting(server: AutomationHttpServer, project: WatchedProject): number {
  return server.planning!.listWorkItems(project.id, 'triage').length
}

/** The lesson editor, or an error when main has not set one up. */
function lessonEditor(server: AutomationHttpServer) {
  const lessons = server.conventions
  if (!lessons?.addLesson || !lessons.updateLesson || !lessons.removeLesson) {
    throw new Error('Project lessons unavailable')
  }
  return lessons as Required<typeof lessons>
}

/** A project's own settings: auto-dispatch, triage, stage, prefix, appearance, conventions and lessons, workspace setup, AI. */

export const PROJECT_SETTINGS_ROUTES: AutomationRouteDef[] = [
  {
    method: 'GET',
    path: '/auto-dispatch',
    description:
      'Read the project automation settings: auto-dispatch on/off, concurrent embedded sessions, the project\'s own model for the built-in agent (aiOverrideEnabled, defaultProvider, defaultModel, defaultEffort: the project default a run uses unless it chose its own), auto-archive days, agentsPlanFirst: true makes every task whose own planFirst is "default" ask its agent for a plan before it changes anything, set when the task is queued; off by default, and reviewBeforeMe: true starts a review (POST /sessions/:sessionId/review) of each session that enters review with changes, a second run that counts towards usage limits; off by default.',
    response: '{ ok: true, value: ProjectAutoDispatchConfig }',
    handler: ({ server, project, res }) => {
      if (!server.autoDispatch) throw new Error('Auto-dispatch settings unavailable')
      respondJson(res, 200, { ok: true, value: server.autoDispatch.get(project.id) })
    }
  },
  {
    method: 'PATCH',
    path: '/auto-dispatch',
    description:
      'Change any of those settings, as Settings does; dispatch is re-evaluated immediately. Note: maxConcurrentEmbeddedSessions 0 means no embedded sessions start, so set it to 1 or more when enabling.',
    request: `JSON body with any of { ${AUTO_DISPATCH_FIELDS.join(', ')} }. defaultEffort is "" (the provider default) or an effort level.`,
    response: '{ ok: true, value: ProjectAutoDispatchConfig }',
    exampleBody: { enabled: true, maxConcurrentEmbeddedSessions: 1 },
    handler: ({ server, project, res, body }) => {
      if (!server.autoDispatch) throw new Error('Auto-dispatch settings unavailable')
      // Only the documented fields; projectId and anything else are ignored.
      const updates: Partial<ProjectAutoDispatchConfig> = {}
      for (const key of AUTO_DISPATCH_FIELDS) {
        if (body[key] !== undefined) (updates as Record<string, unknown>)[key] = body[key]
      }
      if (Object.keys(updates).length === 0) {
        throw new Refusal(`Send at least one of: ${AUTO_DISPATCH_FIELDS.join(', ')}`)
      }
      const value = server.autoDispatch.update(project.id, updates)
      server.recordMutation(project, '/auto-dispatch', 'automation-api auto-dispatch update')
      // Same as saving from Settings: re-evaluate dispatch now, so turning
      // it on starts queued work without waiting for the next state change.
      server.onHarnessStateChange?.(project)
      respondJson(res, 200, { ok: true, value })
    }
  },
  {
    method: 'GET',
    path: '/triage',
    description:
      "Read this project's Triage new captures setting, as Project settings shows it, and how many tasks wait in To triage. With it on, quick captures (the app's quick add, Snip to task, tasks from text, and POST /work-items with triage: true) wait in To triage instead of the Backlog. A task in To triage (inTriage: true) counts nowhere: not the Board, List, Calendar, Timeline, Home's Today and Upcoming, My work, Workload, reports, milestone progress or the agents' queue (queueing it is refused, \"Accept it from To triage first\"), and it gets no due reminder until it is accepted. Search still finds it. Off by default.",
    response: '{ ok: true, value: { enabled: boolean, waiting: number } }',
    handler: ({ server, project, res }) => {
      respondJson(res, 200, {
        ok: true,
        value: { enabled: triageOn(project), waiting: triageWaiting(server, project) }
      })
    }
  },
  {
    method: 'PUT',
    path: '/triage',
    description:
      'Turn Triage new captures on or off, as Project settings does. Turning it off while tasks wait in To triage is refused (HTTP 400) unless acceptWaiting: true, which first accepts every waiting task into the Backlog, as the app offers.',
    request: 'JSON body { enabled: boolean, acceptWaiting?: boolean }',
    response: '{ ok: true, value: { enabled: boolean, waiting: number, accepted: number } }',
    exampleBody: { enabled: true },
    handler: ({ server, project, res, body }) => {
      if (!server.triageSetting || !server.planning) throw new Error('Triage unavailable')
      if (typeof body.enabled !== 'boolean') throw new Refusal('Send enabled: true or false')
      if (body.acceptWaiting !== undefined && typeof body.acceptWaiting !== 'boolean')
        throw new Refusal('acceptWaiting must be true or false')
      let accepted = 0
      const waiting = triageWaiting(server, project)
      if (!body.enabled && waiting > 0) {
        if (body.acceptWaiting !== true)
          throw new Refusal(
            `${waiting} tasks wait in To triage; send acceptWaiting: true to accept them into the Backlog`
          )
        accepted = acceptAllFromTriage(server.planning, project, AUTOMATION_ACTOR)
      }
      const enabled = server.triageSetting.update(project.id, body.enabled)
      server.recordMutation(project, '/triage', 'automation-api triage update')
      respondJson(res, 200, {
        ok: true,
        value: { enabled, waiting: triageWaiting(server, project), accepted }
      })
    }
  },
  {
    method: 'GET',
    path: '/stage',
    description:
      "Read this project's stage on Home's board of projects: planning, active, on-hold or done. On hold and Done projects leave Home's Today and Upcoming, My work and the Inbox's blocker nudges; reminders, agents and auto-dispatch are not affected.",
    response: '{ ok: true, value: { stage } }',
    handler: ({ project, res }) => {
      respondJson(res, 200, { ok: true, value: { stage: normalizeProjectStage(project.stage) } })
    }
  },
  {
    method: 'PUT',
    path: '/stage',
    description:
      "Set this project's stage, as dragging its card on Home's board does. Moving it back to planning or active brings its tasks back into Today at once. An unknown stage is HTTP 400. Archiving a project is not a stage.",
    request: `JSON body { stage: ${PROJECT_STAGES.map((stage) => `"${stage}"`).join(' | ')} }`,
    response: '{ ok: true, value: { stage } }',
    exampleBody: { stage: 'on-hold' },
    handler: ({ server, project, res, body }) => {
      if (!server.projectStage) throw new Error('Project stage unavailable')
      if (!isProjectStage(body.stage)) {
        throw new Refusal(`Send stage: one of ${PROJECT_STAGES.join(', ')}`)
      }
      const stage = server.projectStage.update(project.id, body.stage)
      server.recordMutation(project, '/stage', 'automation-api stage update')
      respondJson(res, 200, { ok: true, value: { stage } })
    }
  },
  {
    method: 'GET',
    path: '/task-prefix',
    description:
      "Read the prefix of this project's task IDs: two to five capital letters, so a task with number 12 has the ID PREFIX-12 (each work item's key).",
    response: '{ ok: true, value: { taskPrefix } }',
    handler: ({ project, res }) => {
      respondJson(res, 200, { ok: true, value: { taskPrefix: project.taskPrefix ?? null } })
    }
  },
  {
    method: 'PUT',
    path: '/task-prefix',
    description:
      "Change the prefix of this project's task IDs, as Project settings does: two to five letters A to Z, made capital. Every task's ID changes at once, and old IDs in commits and notes no longer match. A prefix another project uses, or one that is not two to five letters, is HTTP 400.",
    request: 'JSON body { taskPrefix: string }',
    response: '{ ok: true, value: { taskPrefix } }',
    exampleBody: { taskPrefix: 'SHOP' },
    handler: ({ server, project, res, body }) => {
      if (!server.taskPrefix) throw new Error('Task prefix unavailable')
      if (typeof body.taskPrefix !== 'string')
        throw new Refusal('Send taskPrefix: two to five letters, A to Z')
      let taskPrefix: string
      try {
        taskPrefix = server.taskPrefix.update(project.id, body.taskPrefix)
      } catch (error) {
        throw new Refusal(error instanceof Error ? error.message : String(error))
      }
      server.recordMutation(project, '/task-prefix', 'automation-api task prefix update')
      respondJson(res, 200, { ok: true, value: { taskPrefix } })
    }
  },
  {
    method: 'GET',
    path: '/appearance',
    description:
      'Read the area and icon of this project: areaId (an id from GET /areas, or null for "No area") and icon (an id from the curated set, or null for none).',
    response: '{ ok: true, value: { areaId, icon } }',
    handler: ({ project, res }) => {
      respondJson(res, 200, {
        ok: true,
        value: { areaId: project.areaId ?? null, icon: project.icon ?? null }
      })
    }
  },
  {
    method: 'PATCH',
    path: '/appearance',
    description:
      'Put this project in an area and give it an icon, as Project settings does. A field left out keeps its value. An unknown area or icon is HTTP 400.',
    request: `JSON body with any of { areaId: string | null, icon: string | null }. icon is one of: ${PROJECT_ICONS.join(', ')}.`,
    response: '{ ok: true, value: { areaId, icon } }',
    exampleBody: { areaId: null, icon: 'house' },
    handler: ({ server, project, res, body }) => {
      const appearance = server.appearance
      if (!appearance) throw new Error('Project appearance unavailable')
      const updates: { areaId?: string | null; icon?: string | null } = {}
      if (body.areaId !== undefined) updates.areaId = body.areaId as string | null
      if (body.icon !== undefined) updates.icon = body.icon as string | null
      if (Object.keys(updates).length === 0) throw new Refusal('Send areaId, icon or both')
      if (updates.icon !== undefined && updates.icon !== null && !isProjectIcon(updates.icon)) {
        throw new Refusal(`Unknown icon. Use one of: ${PROJECT_ICONS.join(', ')}, or null`)
      }
      if (
        updates.areaId !== undefined &&
        updates.areaId !== null &&
        !appearance.areas().some((area) => area.id === updates.areaId)
      ) {
        throw new Refusal('Unknown area. GET /automation/areas lists them; null is "No area"')
      }
      const value = appearance.update(project.id, updates)
      server.recordMutation(project, '/appearance', 'automation-api appearance update')
      respondJson(res, 200, { ok: true, value })
    }
  },
  {
    method: 'GET',
    path: '/update-reminder',
    description:
      "Read this project's status update reminder: cadence off, weekly or fortnightly, weekday 0 (Sunday) to 6 (Saturday), and since, the day it was set (YYYY-MM-DD, or null while off). On its day, unless an update was posted since that day began, the Inbox shows Time for a status update and a desktop notification follows the reminders' notification setting. On hold and Done projects get no reminder.",
    response: '{ ok: true, value: { cadence, weekday, since } }',
    handler: ({ project, res }) => {
      respondJson(res, 200, { ok: true, value: normalizeUpdateReminder(project.updateReminder) })
    }
  },
  {
    method: 'PUT',
    path: '/update-reminder',
    description:
      'Set the reminder, as Project settings › Status update reminder does. A field left out keeps its value. Turning it on, or changing it, starts it today (since); fortnights count from the first chosen weekday on or after that day. A bad cadence or weekday is HTTP 400.',
    request: 'JSON body: { cadence?: "off" | "weekly" | "fortnightly", weekday?: 0-6 }',
    response: '{ ok: true, value: { cadence, weekday, since } }',
    exampleBody: { cadence: 'weekly', weekday: 5 },
    handler: ({ server, project, res, body }) => {
      if (!server.updateReminder) throw new Error('Status update reminder unavailable')
      let value: UpdateReminder
      try {
        value = server.updateReminder.update(project.id, {
          ...(body.cadence !== undefined ? { cadence: body.cadence } : {}),
          ...(body.weekday !== undefined ? { weekday: body.weekday } : {})
        } as Partial<UpdateReminder>)
      } catch (error) {
        // The one validation (`parseUpdateReminder`): a bad value is the caller's.
        throw new Refusal(error instanceof Error ? error.message : String(error))
      }
      server.recordMutation(project, '/update-reminder', 'automation-api status update reminder')
      respondJson(res, 200, { ok: true, value })
    }
  },
  {
    method: 'GET',
    path: '/conventions',
    description:
      'Read the project\'s conventions for coding agents: owner-written markdown every agent on the project receives with its task (embedded agents as OSTLER_PROJECT_CONVENTIONS.md, connected agents as projectConventions). Empty when there are none. lessons lists the project\'s lessons from earlier reviews, oldest first: agents read the ones that are on (enabled) after the conventions, under "Lessons from earlier reviews", each with the date it was added (addedAt, ms). source is the send-back it came from, or null.',
    response:
      '{ ok: true, value: { agentConventions: string, lessons: [{ id, text, enabled, addedAt, source: { sessionId, taskTitle } | null }] } }',
    handler: ({ project, res }) => {
      respondJson(res, 200, {
        ok: true,
        value: {
          agentConventions: project.agentConventions ?? '',
          lessons: projectLessons(project)
        }
      })
    }
  },
  {
    method: 'PATCH',
    path: '/conventions',
    mcp: { excluded: 'Conventions are read only over MCP.' },
    description:
      'Replace the conventions, as Project settings › Agents does (at most 20,000 characters; "" clears them). The next agent run and every claim after this get the new text. Conventions are project context, never extra access.',
    request: 'JSON body { agentConventions: string }.',
    response: '{ ok: true, value: { agentConventions: string } }',
    exampleBody: { agentConventions: '- Run npm test before committing.' },
    handler: ({ server, project, res, body }) => {
      if (!server.conventions) throw new Error('Project conventions unavailable')
      if (typeof body.agentConventions !== 'string') {
        throw new Refusal('Send agentConventions as markdown text ("" clears it)')
      }
      const agentConventions = server.conventions.update(project.id, body.agentConventions)
      server.recordMutation(project, '/conventions', 'automation-api conventions update')
      respondJson(res, 200, { ok: true, value: { agentConventions } })
    }
  },
  {
    method: 'POST',
    path: '/lessons',
    mcp: { excluded: 'Lessons are read only over MCP.' },
    description:
      'Add a lesson from earlier reviews, on, as Remember this for next time does: one rule for any task on this project, at most 500 characters, at most 100 lessons per project. Every later agent reads it after the conventions. Lessons are project context, never extra access.',
    request: 'JSON body { text: string }.',
    response: '{ ok: true, value: { id, text, enabled: true, addedAt, source: null } }',
    exampleBody: {
      text: 'Use formatDate from src/shared/format.ts for dates, never a new helper.'
    },
    handler: ({ server, project, res, body }) => {
      const lessons = lessonEditor(server)
      if (body.text === undefined) throw new Refusal('Send text: the lesson')
      const value = lessons.addLesson(project.id, body.text)
      server.recordMutation(project, '/lessons', 'automation-api lesson add')
      respondJson(res, 201, { ok: true, value })
    }
  },
  {
    method: 'PATCH',
    path: '/lessons/:lessonId',
    mcp: { excluded: 'Lessons are read only over MCP.' },
    description:
      "Change a lesson's text (at most 500 characters) or turn it off or on. A lesson that is off is kept, and agents no longer read it.",
    request: 'JSON body { text?: string, enabled?: boolean }.',
    response: '{ ok: true, value: { id, text, enabled, addedAt, source } }',
    exampleBody: { enabled: false },
    handler: ({ server, project, res, body, params }) => {
      const lessons = lessonEditor(server)
      const id = params.lessonId!
      if (!projectLessons(project).some((lesson) => lesson.id === id)) {
        return respondJson(res, 404, { ok: false, error: `Lesson with ID ${id} not found` })
      }
      if (body.text === undefined && body.enabled === undefined) {
        throw new Refusal('Send text, enabled or both')
      }
      const value = lessons.updateLesson(project.id, id, { text: body.text, enabled: body.enabled })
      server.recordMutation(project, '/lessons', 'automation-api lesson update')
      respondJson(res, 200, { ok: true, value })
    }
  },
  {
    method: 'DELETE',
    path: '/lessons/:lessonId',
    mcp: { excluded: 'Lessons are read only over MCP.' },
    description: 'Delete a lesson; agents stop reading it from their next run or claim.',
    response: '{ ok: true, value: { id, deleted: true } }',
    handler: ({ server, project, res, params }) => {
      const lessons = lessonEditor(server)
      const id = params.lessonId!
      if (!projectLessons(project).some((lesson) => lesson.id === id)) {
        return respondJson(res, 404, { ok: false, error: `Lesson with ID ${id} not found` })
      }
      lessons.removeLesson(project.id, id)
      server.recordMutation(project, '/lessons', 'automation-api lesson delete')
      respondJson(res, 200, { ok: true, value: { id, deleted: true } })
    }
  },
  {
    method: 'GET',
    path: '/workspace-setup',
    description:
      'Read how a new agent workspace is prepared before the agent starts: agentSetup.mode is auto (install dependencies from the lockfile the project has, the default), custom (agentSetup.command runs instead) or off. Automatic runs nothing when no recognised lockfile is found. Coding agents cannot read or change this through their own token.',
    response:
      '{ ok: true, value: { agentSetup: { mode: "auto" | "off" | "custom", command?: string } } }',
    handler: ({ project, res }) => {
      respondJson(res, 200, {
        ok: true,
        value: { agentSetup: project.agentSetup ?? { mode: 'auto' } }
      })
    }
  },
  {
    method: 'PATCH',
    path: '/workspace-setup',
    description:
      'Replace how new agent workspaces are prepared, as Project settings › Agents does. Applies to the next session started; a session already running keeps the setup it was given. A custom command must not be blank and runs in each new workspace with CI=1.',
    request:
      'JSON body { agentSetup: { mode: "auto" } | { mode: "off" } | { mode: "custom", command: string } }.',
    response:
      '{ ok: true, value: { agentSetup: { mode: "auto" | "off" | "custom", command?: string } } }',
    exampleBody: { agentSetup: { mode: 'custom', command: 'npm ci' } },
    handler: ({ server, project, res, body }) => {
      if (!server.workspaceSetup) throw new Error('Workspace setup unavailable')
      if (body.agentSetup === undefined) {
        throw new Refusal(
          'Send agentSetup as { mode: "auto" | "off" | "custom", command?: string }'
        )
      }
      const agentSetup = server.workspaceSetup.update(project.id, body.agentSetup)
      server.recordMutation(project, '/workspace-setup', 'automation-api workspace setup update')
      respondJson(res, 200, { ok: true, value: { agentSetup } })
    }
  },
  {
    method: 'GET',
    path: '/ai-settings',
    mcp: { excluded: 'Ostler AI settings are not planning.' },
    description:
      "Read how Ostler AI's planning prompts write tasks for this project: profileSetting auto, software or general, and profile, what auto comes to now (software when a linked folder is a Git repository).",
    response: '{ ok: true, value: { projectId, profileSetting, profile } }',
    handler: async ({ server, project, res }) => {
      if (!server.projectAi) throw new Error('AI settings unavailable')
      respondJson(res, 200, { ok: true, value: await server.projectAi.get(project.id) })
    }
  },
  {
    method: 'PATCH',
    path: '/ai-settings',
    mcp: { excluded: 'Ostler AI settings are not planning.' },
    description: 'Change the setting, as the project settings dialog does.',
    request: 'JSON body { profileSetting: "auto" | "software" | "general" }.',
    response: '{ ok: true, value: { projectId, profileSetting, profile } }',
    exampleBody: { profileSetting: 'general' },
    handler: async ({ server, project, res, body }) => {
      if (!server.projectAi) throw new Error('AI settings unavailable')
      if (body.profileSetting === undefined) throw new Refusal('Send profileSetting')
      const value = await server.projectAi.update(project.id, {
        profileSetting: body.profileSetting
      })
      server.recordMutation(project, '/ai-settings', 'automation-api ai settings update')
      respondJson(res, 200, { ok: true, value })
    }
  }
]
