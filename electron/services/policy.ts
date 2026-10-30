/**
 * The organisation's policy (docs/plans/integrations/overview.md, phase 7):
 * `%ProgramData%\Ostler\policy.json`, then `HKLM\Software\Policies\Ostler`
 * (Group Policy and Intune write there), read once at start. Anything that
 * can't be read is left out, never guessed: a broken policy file leaves
 * Ostler as it would be without one, and says so in the log.
 *
 * policy.json:
 *   {
 *     "apps": { "microsoft": { "clientId": "…", "tenant": "contoso.onmicrosoft.com" },
 *               "google": { "clientId": "…" } },
 *     "forbiddenProviders": ["dropbox"],
 *     "syncServer": { "url": "https://sync.contoso.com", "signIn": "microsoft",
 *                     "scope": "api://ostler-sync/sync" },
 *     "disableAi": false,
 *     "disableAgents": true
 *   }
 *
 * Registry values (REG_SZ unless said): GoogleClientId, MicrosoftClientId,
 * MicrosoftTenant, DropboxClientId, ForbiddenProviders (comma-separated),
 * SyncServerUrl, SyncServerSignIn (`key` or `microsoft`), SyncServerScope,
 * DisableAi and DisableAgents (REG_DWORD 1).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  EMPTY_POLICY,
  type AccountProvider,
  type OrgPolicy,
  type PolicyApp,
  type PolicySummary,
  type PolicySyncServer
} from '@shared/ostler-api'

const PROVIDERS: readonly AccountProvider[] = ['google', 'microsoft', 'caldav', 'dropbox']
const APP_PROVIDERS = ['google', 'microsoft', 'dropbox'] as const
export const POLICY_REGISTRY_KEY = 'HKLM\\Software\\Policies\\Ostler'

export interface PolicySources {
  /** `%ProgramData%`; null off Windows. */
  programData: string | null
  /** The registry key's values as `reg query` prints them; '' when there is none. */
  registry(): Promise<string>
  log?(message: string): void
}

/** Reads the policy from both places; the registry wins. */
export async function readPolicy(sources: PolicySources): Promise<OrgPolicy> {
  const fromFile = sources.programData
    ? policyFromJson(readFile(path.join(sources.programData, 'Ostler', 'policy.json'), sources.log))
    : {}
  let registry = ''
  try {
    registry = await sources.registry()
  } catch {
    registry = ''
  }
  const fromRegistry = policyFromRegistry(registry)
  return {
    apps: { ...fromFile.apps, ...fromRegistry.apps },
    forbiddenProviders: fromRegistry.forbiddenProviders ?? fromFile.forbiddenProviders ?? [],
    syncServer: fromRegistry.syncServer ?? fromFile.syncServer ?? null,
    disableAi: fromRegistry.disableAi ?? fromFile.disableAi ?? false,
    disableAgents: fromRegistry.disableAgents ?? fromFile.disableAgents ?? false
  }
}

/** The real sources on this PC. */
export function systemPolicySources(log: (message: string) => void): PolicySources {
  const isWindows = process.platform === 'win32'
  return {
    programData: isWindows ? (process.env.ProgramData ?? 'C:\\ProgramData') : null,
    registry: () =>
      isWindows
        ? new Promise((resolve) => {
            execFile(
              'reg',
              ['query', POLICY_REGISTRY_KEY],
              { windowsHide: true, timeout: 5000 },
              (error, stdout) => resolve(error ? '' : stdout)
            )
          })
        : Promise.resolve(''),
    log
  }
}

export function policySummary(policy: OrgPolicy): PolicySummary {
  const appsFor = APP_PROVIDERS.filter((provider) => policy.apps[provider]?.clientId)
  const summary: PolicySummary = {
    managed: false,
    forbiddenProviders: [...policy.forbiddenProviders],
    appsFor,
    syncServer: policy.syncServer
      ? { url: policy.syncServer.url, signIn: policy.syncServer.signIn }
      : null,
    disableAi: policy.disableAi,
    disableAgents: policy.disableAgents
  }
  summary.managed =
    summary.forbiddenProviders.length > 0 ||
    appsFor.length > 0 ||
    summary.syncServer !== null ||
    summary.disableAi ||
    summary.disableAgents
  return summary
}

type PartialPolicy = Partial<Omit<OrgPolicy, 'apps'>> & { apps?: OrgPolicy['apps'] }

function readFile(file: string, log?: (message: string) => void): unknown {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    log?.(`The policy file ${file} isn't valid JSON; it was left out.`)
    return null
  }
}

/** The policy file's settings that are well formed; the rest are left out. */
export function policyFromJson(value: unknown): PartialPolicy {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const policy: PartialPolicy = {}
  if (raw.apps && typeof raw.apps === 'object') {
    policy.apps = {}
    for (const provider of APP_PROVIDERS) {
      const app = app_((raw.apps as Record<string, unknown>)[provider])
      if (app) policy.apps[provider] = app
    }
  }
  if (Array.isArray(raw.forbiddenProviders)) {
    policy.forbiddenProviders = providers(raw.forbiddenProviders)
  }
  const server = syncServer(raw.syncServer)
  if (server) policy.syncServer = server
  if (typeof raw.disableAi === 'boolean') policy.disableAi = raw.disableAi
  if (typeof raw.disableAgents === 'boolean') policy.disableAgents = raw.disableAgents
  return policy
}

/** `reg query` output: lines of "    Name    REG_TYPE    Value". */
export function policyFromRegistry(text: string): PartialPolicy {
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*)$/.exec(line)
    if (match) values.set(match[1].toLowerCase(), match[2].trim())
  }
  const policy: PartialPolicy = {}
  const apps: OrgPolicy['apps'] = {}
  for (const provider of APP_PROVIDERS) {
    const clientId = values.get(`${provider}clientid`)
    if (clientId) {
      apps[provider] = {
        clientId,
        ...(provider === 'microsoft' && values.get('microsofttenant')
          ? { tenant: values.get('microsofttenant') }
          : {})
      }
    }
  }
  if (Object.keys(apps).length > 0) policy.apps = apps
  const forbidden = values.get('forbiddenproviders')
  if (forbidden !== undefined) policy.forbiddenProviders = providers(forbidden.split(','))
  const server = syncServer({
    url: values.get('syncserverurl'),
    signIn: values.get('syncserversignin') ?? 'key',
    scope: values.get('syncserverscope')
  })
  if (server) policy.syncServer = server
  const flag = (name: string) => {
    const value = values.get(name)
    if (value === undefined) return undefined
    return value === '1' || /^0x0*1$/i.test(value)
  }
  const ai = flag('disableai')
  if (ai !== undefined) policy.disableAi = ai
  const agents = flag('disableagents')
  if (agents !== undefined) policy.disableAgents = agents
  return policy
}

function app_(value: unknown): PolicyApp | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.clientId !== 'string' || !/^[\w.-]{8,200}$/.test(raw.clientId)) return null
  return {
    clientId: raw.clientId,
    ...(typeof raw.clientSecret === 'string' && raw.clientSecret
      ? { clientSecret: raw.clientSecret }
      : {}),
    ...(typeof raw.tenant === 'string' && /^[\w.-]{2,200}$/.test(raw.tenant)
      ? { tenant: raw.tenant }
      : {})
  }
}

function providers(values: unknown[]): AccountProvider[] {
  return PROVIDERS.filter((provider) =>
    values.some((value) => typeof value === 'string' && value.trim().toLowerCase() === provider)
  )
}

function syncServer(value: unknown): PolicySyncServer | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.url !== 'string') return null
  let url: URL
  try {
    url = new URL(raw.url)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  const signIn = raw.signIn === 'microsoft' ? 'microsoft' : 'key'
  const scope = typeof raw.scope === 'string' && raw.scope.trim() ? raw.scope.trim() : undefined
  if (signIn === 'microsoft' && !scope) return null
  return {
    url: url.origin + url.pathname.replace(/\/+$/, ''),
    signIn,
    ...(scope ? { scope } : {})
  }
}

export { EMPTY_POLICY }
