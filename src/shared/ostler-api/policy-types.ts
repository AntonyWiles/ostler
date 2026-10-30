import type { AccountProvider } from './account-types'

/**
 * An organisation's policy (docs/plans/integrations/overview.md, phase 7,
 * "Companies"): read at start from `%ProgramData%\Ostler\policy.json` and the
 * same settings under `HKLM\Software\Policies\Ostler`, so Intune and Group
 * Policy can set it. The registry wins where both say something. What the
 * policy sets shows in Settings as "Set by your organisation" in place of the
 * control.
 */
export interface OrgPolicy {
  /** The organisation's own app registrations, used before a person's own. */
  apps: Partial<Record<Exclude<AccountProvider, 'caldav'>, PolicyApp>>
  /** Kinds of account that can't be connected. */
  forbiddenProviders: AccountProvider[]
  /** The organisation's sync server, offered for sharing projects. */
  syncServer: PolicySyncServer | null
  /** Ostler AI off, whatever Settings says. */
  disableAi: boolean
  /** AI agents off, whatever Settings says. */
  disableAgents: boolean
}

export interface PolicyApp {
  clientId: string
  /** Rarely needed: desktop apps are public clients. */
  clientSecret?: string
  /** Microsoft only: the organisation's tenant, in place of `common`. */
  tenant?: string
}

export interface PolicySyncServer {
  /** `https://sync.example.com`. */
  url: string
  /** How a PC proves itself: an access key, or a Microsoft work account. */
  signIn: 'key' | 'microsoft'
  /** For `microsoft`: the server's API scope, such as `api://<app-id>/sync`. */
  scope?: string
}

/** What the renderer is told: no client IDs or secrets. */
export interface PolicySummary {
  managed: boolean
  forbiddenProviders: AccountProvider[]
  appsFor: AccountProvider[]
  syncServer: { url: string; signIn: 'key' | 'microsoft' } | null
  disableAi: boolean
  disableAgents: boolean
}

export const EMPTY_POLICY: OrgPolicy = {
  apps: {},
  forbiddenProviders: [],
  syncServer: null,
  disableAi: false,
  disableAgents: false
}
