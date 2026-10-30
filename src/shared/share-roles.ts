import type { ShareRole } from './ostler-api'

/**
 * The one statement of what each role may do in a shared project (team-leaders plan, D3). The
 * Sharing panel draws its "What each role can do" table from it, and `commentPermissions` reads
 * it. The rules themselves are enforced in the main process: `electron/services/sync/roles.ts`
 * (who may invite, change roles and remove), `capture.ts` (the writer's own PC) and
 * `sync-runner.ts` (every receiving PC). Change a role's rights here and there together.
 */
export interface RoleCapabilities {
  invite: boolean
  changeRoles: boolean
  removePeople: boolean
  editProjectSettings: boolean
  createTasks: boolean
  editAnyTask: boolean
  editOwnTasks: boolean
  deleteTasks: boolean
  editLibrary: boolean
  comment: boolean
  pinComments: boolean
  deleteAnyComment: boolean
  logOwnTime: boolean
  /** Asks a named person to sign off a task, decision or milestone (a Contributor: their own tasks). */
  requestSignOff: boolean
  /** Approves or sends back a sign-off addressed to them, whatever their role (D9). */
  answerSignOffs: boolean
}

/** The roles in order of rights, most first. */
export const SHARE_ROLES: readonly ShareRole[] = ['owner', 'editor', 'contributor', 'viewer']

const EVERYTHING: RoleCapabilities = {
  invite: true,
  changeRoles: true,
  removePeople: true,
  editProjectSettings: true,
  createTasks: true,
  editAnyTask: true,
  editOwnTasks: true,
  deleteTasks: true,
  editLibrary: true,
  comment: true,
  pinComments: true,
  deleteAnyComment: true,
  logOwnTime: true,
  requestSignOff: true,
  answerSignOffs: true
}

export const ROLE_CAPABILITIES: Readonly<Record<ShareRole, RoleCapabilities>> = {
  owner: EVERYTHING,
  editor: {
    ...EVERYTHING,
    changeRoles: false,
    removePeople: false,
    deleteAnyComment: false
  },
  contributor: {
    invite: false,
    changeRoles: false,
    removePeople: false,
    editProjectSettings: false,
    createTasks: false,
    editAnyTask: false,
    editOwnTasks: true,
    deleteTasks: false,
    editLibrary: false,
    comment: true,
    pinComments: false,
    deleteAnyComment: false,
    logOwnTime: true,
    requestSignOff: true,
    answerSignOffs: true
  },
  viewer: {
    invite: false,
    changeRoles: false,
    removePeople: false,
    editProjectSettings: false,
    createTasks: false,
    editAnyTask: false,
    editOwnTasks: false,
    deleteTasks: false,
    editLibrary: false,
    comment: true,
    pinComments: false,
    deleteAnyComment: false,
    logOwnTime: false,
    requestSignOff: false,
    answerSignOffs: true
  }
}

/** The capabilities of a role; `null` (a project that is not shared) gets an Owner's. */
export function capabilitiesOf(role: ShareRole | null): RoleCapabilities {
  return ROLE_CAPABILITIES[role ?? 'owner']
}
