/**
 * The providers a connected account can be with (docs/plans/integrations/overview.md,
 * "Providers" and "Connected accounts"). Each declares what it can give
 * (capabilities), how it signs in, and the only hosts its calls may reach:
 * `account-fetch.ts` refuses every other host, the way `calendar-link-fetch.ts`
 * fetches only the address a person pasted.
 *
 * Built-in app registrations are empty until Ostler is registered with Google,
 * Microsoft and Dropbox (overview, decision 2, still open). Until then a
 * provider signs in with your organisation's registration (the policy file,
 * phase 7) or one you added in Settings.
 */
import type { AccountCapability, AccountProvider } from '@shared/ostler-api'

export interface OAuthProvider {
  provider: 'google' | 'microsoft' | 'dropbox'
  method: 'oauth'
  authorizeUrl: string
  tokenUrl: string
  /** Where a refresh token is revoked on disconnect; null when the provider has none. */
  revokeUrl: string | null
  /** Asked for every time: who the account is, and a refresh token. */
  baseScopes: string[]
  scopes: Partial<Record<AccountCapability, string[]>>
  /** Extra authorize parameters (Google needs `access_type=offline` for a refresh token). */
  authorizeParams: Record<string, string>
  /** The account's email or name, read once after signing in. */
  profileUrl: string
  profileLabel(profile: Record<string, unknown>): string | null
  hosts: string[]
  /** Ostler's own registration; '' until it is registered (decision 2). */
  builtInClientId: string
}

export interface PasswordProvider {
  provider: 'caldav'
  method: 'password'
  capabilities: AccountCapability[]
}

export type ProviderDefinition = OAuthProvider | PasswordProvider

const GOOGLE: OAuthProvider = {
  provider: 'google',
  method: 'oauth',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  baseScopes: ['openid', 'email'],
  scopes: {
    'calendar.read': ['https://www.googleapis.com/auth/calendar.readonly'],
    'calendar.write': ['https://www.googleapis.com/auth/calendar.events'],
    'contacts.read': ['https://www.googleapis.com/auth/contacts.readonly'],
    // Only files the person picks or opens with Ostler: never the whole Drive (restricted scopes need CASA).
    'files.pick': ['https://www.googleapis.com/auth/drive.file'],
    // Sync through a folder Ostler makes in Drive: the full scope, because drive.file can't see
    // files across sign-in clients or accounts (plan mobile, 01a). Testing mode, so no CASA (D16).
    'sync.drive': ['https://www.googleapis.com/auth/drive'],
    'tasks.sync': ['https://www.googleapis.com/auth/tasks']
  },
  authorizeParams: { access_type: 'offline', prompt: 'consent' },
  profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  profileLabel: (profile) => (typeof profile.email === 'string' ? profile.email : null),
  hosts: [
    'oauth2.googleapis.com',
    'openidconnect.googleapis.com',
    'www.googleapis.com',
    'people.googleapis.com',
    'tasks.googleapis.com'
  ],
  builtInClientId: ''
}

const MICROSOFT: OAuthProvider = {
  provider: 'microsoft',
  method: 'oauth',
  // `common`: work, school and personal accounts with one multi-tenant registration.
  authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  revokeUrl: null,
  baseScopes: ['openid', 'email', 'offline_access', 'User.Read'],
  scopes: {
    'calendar.read': ['Calendars.Read'],
    'calendar.write': ['Calendars.ReadWrite'],
    'contacts.read': ['Contacts.Read'],
    'files.pick': ['Files.Read'],
    'tasks.sync': ['Tasks.ReadWrite']
  },
  authorizeParams: { prompt: 'select_account' },
  profileUrl: 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
  profileLabel: (profile) =>
    typeof profile.mail === 'string' && profile.mail
      ? profile.mail
      : typeof profile.userPrincipalName === 'string'
        ? profile.userPrincipalName
        : null,
  hosts: ['login.microsoftonline.com', 'graph.microsoft.com'],
  builtInClientId: ''
}

const DROPBOX: OAuthProvider = {
  provider: 'dropbox',
  method: 'oauth',
  authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
  tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
  revokeUrl: 'https://api.dropboxapi.com/2/auth/token/revoke',
  baseScopes: ['account_info.read'],
  scopes: { 'files.pick': ['files.metadata.read', 'sharing.read'] },
  authorizeParams: { token_access_type: 'offline' },
  profileUrl: 'https://api.dropboxapi.com/2/users/get_current_account',
  profileLabel: (profile) => (typeof profile.email === 'string' ? profile.email : null),
  hosts: ['api.dropboxapi.com'],
  builtInClientId: ''
}

const CALDAV: PasswordProvider = {
  provider: 'caldav',
  method: 'password',
  capabilities: ['calendar.read', 'calendar.write', 'contacts.read']
}

export const PROVIDERS: Record<AccountProvider, ProviderDefinition> = {
  google: GOOGLE,
  microsoft: MICROSOFT,
  caldav: CALDAV,
  dropbox: DROPBOX
}

export const ACCOUNT_PROVIDERS = Object.keys(PROVIDERS) as AccountProvider[]

export function isAccountProvider(value: unknown): value is AccountProvider {
  return typeof value === 'string' && value in PROVIDERS
}

/** What a provider can give. */
export function capabilitiesOf(provider: AccountProvider): AccountCapability[] {
  const definition = PROVIDERS[provider]
  return definition.method === 'password'
    ? [...definition.capabilities]
    : (Object.keys(definition.scopes) as AccountCapability[])
}

/** The capabilities asked for when a person connects without saying: reading only. */
export function defaultCapabilities(provider: AccountProvider): AccountCapability[] {
  return capabilitiesOf(provider).filter(
    (capability) => capability.endsWith('.read') || capability === 'files.pick'
  )
}

/** The OAuth scopes for a set of capabilities, with the provider's base scopes. */
export function scopesFor(provider: OAuthProvider, capabilities: AccountCapability[]): string[] {
  const scopes = new Set(provider.baseScopes)
  for (const capability of capabilities) {
    for (const scope of provider.scopes[capability] ?? []) scopes.add(scope)
  }
  return [...scopes]
}

/** iCloud's servers, offered as a preset: CalDAV and CardDAV with an app-specific password. */
export const ICLOUD_SERVER = 'https://caldav.icloud.com'
