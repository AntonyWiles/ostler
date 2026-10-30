/**
 * Sharing a project through a synced folder (docs/plans/integrations/shared-folder-sync.md).
 * The invite and every key stay in the main process; the renderer only ever
 * sees the state below.
 */

/** How a shared project's sync stands on this PC. */
export type ShareStatus = 'up-to-date' | 'catching-up' | 'cannot-reach-folder' | 'problems'

/** What a person may do in a shared project (people and devices, D1). */
export type ShareRole = 'owner' | 'editor' | 'contributor' | 'viewer'

/** A person in a shared project: one or more devices (people and devices, D5). */
export interface ShareMember {
  /** The person's public key (not secret). Identifies the person in removal calls. */
  personKey: string
  name: string
  devices: ShareDevice[]
  /** This person includes this PC. */
  isMe: boolean
  joinedAt: number
  /** The person's role; absent when this PC does not know it yet. */
  role?: ShareRole
  /** When they left the project on their own, with every device; absent while they are in it. */
  leftAt?: number
  /** The person's id in the address book or the project, when this PC knows it. */
  personId?: string
  /** How many open tasks they have in this project; present for an Owner removing them. */
  openTasks?: number
}

/** One line of a shared project's membership history (who joined, left, was removed or changed role). */
export interface MembershipEvent {
  kind: 'joined' | 'left' | 'removed' | 'role-changed' | 'invites-stopped'
  personKey: string
  name: string
  /** When it happened; null when this PC cannot tell. */
  at: number | null
  role?: ShareRole
  previousRole?: ShareRole
  /** Who made a role change or stopped old invites. */
  byName?: string
}

export interface ShareDevice {
  memberId: string
  name: string
  /** This PC itself. */
  isThisPc: boolean
  joinedAt: number
}

export interface ShareState {
  projectId: string
  status: ShareStatus
  /** The shared folder on this PC. */
  folder: string
  members: ShareMember[]
  /** When this PC last wrote to or read from the folder. */
  lastSyncedAt: number | null
  /** Changes made here not yet written to the folder. */
  waitingToSend: number
  /** Received changes still waiting for a row they need, or for a clash to be settled. */
  waitingToApply: number
  /** What could not be read or written, by kind and reason code. Never file contents. */
  problems: ShareProblem[]
  /** Another member removed this PC: nothing more is sent or received. */
  removed: boolean
  /** This PC's own person's role: an Owner sees the role controls, an Editor or Viewer only the roles. */
  myRole: ShareRole
  /** The personal space is on, so this share is listed in it: "Invite people…" rather than "Share this project…" (D17). */
  inPersonalSpace: boolean
  /** Newer sharing features every member's PC understands; an older PC in the share empties it. */
  sharedCapabilities: string[]
  /** When an Owner last stopped every earlier invite; absent if never. */
  invitesResetAt?: number
}

export interface ShareProblem {
  kind: 'member' | 'key' | 'change' | 'library' | 'record' | 'role' | 'folder'
  /** A reason code such as `bad-signature`, `unknown-member` or `hash-mismatch`. */
  reason: string
}

/**
 * "Is this Bob?" (D12): a person here who may be the same as a member's person.
 * Names and ids only; the member's person key is public.
 */
export interface PersonLinkCandidate {
  personKey: string
  memberName: string
  candidatePersonId: string
  candidateName: string
}

/**
 * What joining a shared project made: the project now in the list, or `waiting`
 * when the shared folder is not on this PC yet (the Join step keeps looking).
 */
export type JoinShareResult = { projectId: string; name: string } | { waiting: true }

/**
 * The sync server (integrations phase 7): where projects can be shared in
 * place of a folder. The access key never leaves main.
 */
export interface SyncServerState {
  /** `https://sync.example.com`; null until one is set. */
  url: string | null
  signIn: 'key' | 'microsoft'
  /** For a Microsoft work account: the server's API scope. */
  scope: string | null
  /** The connected Microsoft account it signs in with. */
  accountId: string | null
  hasKey: boolean
  /** The address and way of signing in come from your organisation's policy. */
  managed: boolean
  /** Projects can be shared through it now. */
  ready: boolean
}

export interface SetSyncServerInput {
  url: string
  signIn: 'key' | 'microsoft'
  /** A new access key; left out to keep the saved one. */
  key?: string
  scope?: string
  accountId?: string
}
