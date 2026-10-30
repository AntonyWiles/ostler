/**
 * Connected accounts (docs/plans/integrations/overview.md, "Connected accounts").
 * Tokens and passwords stay in the main process; the renderer sees only what
 * is below: the provider, a label, what the account gives and how it stands.
 */

/** Who an account is with. `caldav` is any CalDAV/CardDAV server, iCloud included. */
export type AccountProvider = 'google' | 'microsoft' | 'caldav' | 'dropbox'

/**
 * What an account can give. Surfaces ask for a capability, never a provider:
 * a new provider lights up every surface that needs what it gives.
 */
export type AccountCapability =
  'calendar.read' | 'calendar.write' | 'contacts.read' | 'files.pick' | 'sync.drive' | 'tasks.sync'

export type AccountStatus = 'connected' | 'needs-reconnect' | 'failed'

/**
 * Why an account call failed, in plain words for the person; never a token,
 * a password or raw error text.
 */
export type AccountFailure =
  | 'unreachable'
  | 'timeout'
  | 'refused'
  | 'expired'
  | 'server'
  | 'tooBig'
  | 'cannotEncrypt'
  | 'pasteAgain'

export interface ConnectedAccount {
  id: string
  provider: AccountProvider
  /** The account's email or user name, as the provider reports it. */
  label: string
  /** For a CalDAV account, the server's host; null for the others. */
  server: string | null
  capabilities: AccountCapability[]
  status: AccountStatus
  failure: AccountFailure | null
  createdAt: number
  /** When the account last answered, ms. */
  lastUsedAt: number | null
}

/** A provider as Settings offers it. */
export interface AccountProviderInfo {
  provider: AccountProvider
  /** `oauth`: the browser opens. `password`: a server, user name and app password. */
  method: 'oauth' | 'password'
  capabilities: AccountCapability[]
  /**
   * OAuth only: true when Ostler has an app registration to sign in with
   * (built in, from your organisation's policy, or one you added). Without
   * one, Settings asks for the app's client ID first.
   */
  ready: boolean
  /** Where the registration came from, when there is one. */
  registration: 'built-in' | 'policy' | 'yours' | null
}

export interface ConnectAccountInput {
  provider: AccountProvider
  /** What to ask for; the provider's read capabilities when left out. */
  capabilities?: AccountCapability[]
  /** CalDAV only. */
  server?: string
  username?: string
  password?: string
}

/** Your own app registration for a provider, when Ostler has none built in. */
export interface AccountAppInput {
  provider: AccountProvider
  clientId: string
  /** Google desktop apps come with one; it is not really secret, but kept sealed. */
  clientSecret?: string
}

/**
 * A Library link to a cloud file (integrations phase 3) as a connected
 * account sees it now. `name` is null when no account could read it:
 * `noAccount` (none connected that picks files there) or the provider's failure.
 */
export interface CloudFileRead {
  service: 'onedrive' | 'sharepoint' | 'googleDrive' | 'dropbox'
  name: string | null
  failure: AccountFailure | 'noAccount' | null
}

/**
 * The calendar time blocks are copied into (integrations phase 6): one
 * calendar of a connected account that can write calendars.
 */
export interface CalendarWriteTarget {
  accountId: string
  /** The calendar's name, as the provider gave it when it was chosen. */
  name: string
  syncedAt: number | null
  failedAt: number | null
  failure: AccountFailure | null
}

export interface SetCalendarWriteTargetInput {
  accountId: string
  /** The provider's id for the calendar, from `listAccountCalendars`. */
  remoteId: string
  name: string
}

/** A Microsoft To Do or Google Tasks list (integrations phase 6). */
export interface AccountTaskList {
  remoteId: string
  name: string
}

/** The list the open tasks assigned to Me are copied into, or null. */
export interface TaskListTarget {
  accountId: string
  name: string
  syncedAt: number | null
  failedAt: number | null
  failure: AccountFailure | null
}

export interface SetTaskListTargetInput {
  accountId: string
  remoteId: string
  name: string
}
