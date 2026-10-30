/**
 * Settings follow the person (docs/plans/people-and-devices/overview.md, D3, D19; prompt 10).
 *
 * The personal share carries one file per change, `settings/<stamp>.ostlersettings`: a sealed
 * envelope (envelope.ts, magic `OSTLERST`) holding the top-level settings that changed on this
 * PC. Only personal settings go in it (`personalSettings`, the device-only ones stay here). A
 * setting is written when its hash differs from the one last sent or received (`sync_settings`),
 * and the newest stamp wins per setting. Secrets (the AI key, the GitHub token) are in the sealed
 * payload as the config holds them, and the config store seals them again when it saves.
 *
 * A setting this PC changed and has not sent yet wins over an older file that arrives for it:
 * the change is what the person just did here, and it is sent next, with a newer stamp.
 */
import { createHash } from './platform'
import type Database from 'better-sqlite3'
import type { OstlerConfig, OstlerConfigUpdate } from '@shared/ostler-api/config-types'
import { personalSettings } from '@shared/sync/device-only-settings'
import { localStamp, observeRemoteStamp } from './capture'
import {
  openEnvelope,
  sealEnvelope,
  type EnvelopeKind,
  type KeySource,
  type SealKeys,
  type SyncFileRefusal
} from './envelope'
import { SyncTransportError } from './transport-paths'
import type { SyncTransport } from './folder-transport'

/** The folder inside the personal share that holds the settings files. */
const SETTINGS_FOLDER = 'settings'
const STAMP = '\\d{15}-\\d{6}-\\S+'
const SETTINGS_FILE_PATH = new RegExp(`^${SETTINGS_FOLDER}/(${STAMP})\\.ostlersettings$`)

/** What the settings sync needs from the config store. The config store itself satisfies it. */
export interface SettingsStore {
  /** The settings this person set on this PC, without the organisation's overlay. */
  getOwn(): OstlerConfig
  /** Applies top-level settings; the store saves them and tells the renderer, as for a local change. */
  update(updates: OstlerConfigUpdate): unknown
  /** Areas change through this, not `update` (see `OstlerConfig.areas`). */
  saveAreas(areas: unknown): unknown
}

export interface SettingsProblem {
  path: string
  reason: SyncFileRefusal | 'unreadable' | 'mismatch'
}

export interface SettingsResult {
  /** The settings this PC took from other devices in this pull. */
  applied: string[]
  problems: SettingsProblem[]
}

class SettingsFileError extends Error {
  constructor(readonly reason: SyncFileRefusal) {
    super(`Settings file refused: ${reason}`)
  }
}

const SETTINGS_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERST', 'ascii'),
  version: 1,
  maxBytes: 4 * 1024 * 1024,
  refuse: (reason) => {
    throw new SettingsFileError(reason)
  }
}

interface ShareRow {
  share_id: string
  member_id: string
  device_id: string
}

interface SettingsHeader {
  memberId: string
  shareId: string
  stamp: string
}

interface KnownSetting {
  stamp: string
  hash: string
}

type Settings = Record<string, unknown>

/** JSON with keys in sorted order, so equal settings hash the same on every PC. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Settings)[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function hashOf(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function personalShareOf(db: Database.Database): ShareRow | null {
  return (
    (db
      .prepare("SELECT share_id, member_id, device_id FROM sync_shares WHERE kind = 'personal'")
      .get() as ShareRow | undefined) ?? null
  )
}

function knownSettings(db: Database.Database, shareId: string): Map<string, KnownSetting> {
  const rows = db
    .prepare('SELECT setting, stamp, hash FROM sync_settings WHERE share_id = @shareId')
    .all({ shareId }) as { setting: string; stamp: string; hash: string }[]
  return new Map(rows.map((row) => [row.setting, { stamp: row.stamp, hash: row.hash }]))
}

function remember(
  db: Database.Database,
  shareId: string,
  setting: string,
  stamp: string,
  hash: string
): void {
  db.prepare(
    `INSERT INTO sync_settings (share_id, setting, stamp, hash)
     VALUES (@shareId, @setting, @stamp, @hash)
     ON CONFLICT(share_id, setting) DO UPDATE SET stamp = excluded.stamp, hash = excluded.hash`
  ).run({ shareId, setting, stamp, hash })
}

/**
 * Writes one settings file holding the personal settings that differ from what was last sent or
 * received. Returns how many settings it sent (0 writes no file).
 */
export async function pushSettings(
  db: Database.Database,
  transport: SyncTransport,
  keys: SealKeys,
  config: OstlerConfig
): Promise<number> {
  const share = personalShareOf(db)
  if (!share) return 0
  const current = personalSettings(config) as Settings
  const known = knownSettings(db, share.share_id)
  const changed: Settings = {}
  const hashes = new Map<string, string>()
  for (const [setting, value] of Object.entries(current)) {
    const hash = hashOf(value)
    if (known.get(setting)?.hash === hash) continue
    changed[setting] = value
    hashes.set(setting, hash)
  }
  if (hashes.size === 0) return 0

  const stamp = localStamp(share.device_id)
  const bytes = sealEnvelope(
    SETTINGS_FILE,
    { formatVersion: 1, shareId: share.share_id, memberId: share.member_id, stamp },
    { settings: changed },
    keys
  )
  try {
    await transport.writeOnce(`${SETTINGS_FOLDER}/${stamp}.ostlersettings`, bytes)
  } catch (error) {
    if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
  }
  for (const [setting, hash] of hashes) remember(db, share.share_id, setting, stamp, hash)
  return hashes.size
}

/**
 * Reads the settings files this PC has not read yet, takes each setting whose newest file is newer
 * than what this PC has, and applies them through the store. A file is read once per run: the
 * files already read are remembered in memory, and their settings are in `sync_settings`.
 */
export async function pullSettings(
  db: Database.Database,
  transport: SyncTransport,
  keys: { projectKey: KeySource },
  store: SettingsStore
): Promise<SettingsResult> {
  const result: SettingsResult = { applied: [], problems: [] }
  const share = personalShareOf(db)
  if (!share) return result

  const files = (await transport.list(SETTINGS_FOLDER))
    .map((path) => ({ path, match: SETTINGS_FILE_PATH.exec(path) }))
    .filter((entry): entry is { path: string; match: RegExpExecArray } => entry.match !== null)
    .sort((a, b) => (a.match[1] < b.match[1] ? -1 : a.match[1] > b.match[1] ? 1 : 0))

  const newest = new Map<string, { stamp: string; value: unknown }>()
  const read = readFiles(db, share.share_id)
  for (const { path, match } of files) {
    if (read.has(path)) continue
    const opened = await openSettingsFile(db, transport, share.share_id, keys, path, match[1])
    if (!opened.ok) {
      // Read again on the next pull unless it was refused for good, or belongs to a removed device.
      if (opened.reason !== 'unreadable') read.add(path)
      if (opened.reason !== null) result.problems.push({ path, reason: opened.reason })
      continue
    }
    read.add(path)
    for (const [setting, value] of Object.entries(opened.settings)) {
      const current = newest.get(setting)
      if (!current || opened.stamp > current.stamp)
        newest.set(setting, { stamp: opened.stamp, value })
    }
  }

  const known = knownSettings(db, share.share_id)
  const own = personalSettings(store.getOwn()) as Settings
  const updates: Settings = {}
  const taken = new Map<string, string>()
  for (const [setting, incoming] of newest) {
    const have = known.get(setting)
    if (have && (have.stamp >= incoming.stamp || hashOf(own[setting]) !== have.hash)) continue
    if (setting === 'areas') {
      store.saveAreas(incoming.value)
    } else {
      updates[setting] = incoming.value
    }
    taken.set(setting, incoming.stamp)
  }
  if (Object.keys(updates).length > 0) {
    try {
      store.update(updates as OstlerConfigUpdate)
    } catch (error) {
      result.problems.push({ path: SETTINGS_FOLDER, reason: 'unreadable' })
      console.error('A shared setting could not be applied:', error)
      return result
    }
  }
  // Remembered as this PC now holds them, so that normalising them on arrival does not make a change.
  const after = personalSettings(store.getOwn()) as Settings
  for (const [setting, stamp] of taken) {
    remember(db, share.share_id, setting, stamp, hashOf(after[setting]))
    result.applied.push(setting)
  }
  return result
}

/** The settings files this PC has read in this run, by path. */
const filesRead = new WeakMap<Database.Database, Map<string, Set<string>>>()

function readFiles(db: Database.Database, shareId: string): Set<string> {
  let byShare = filesRead.get(db)
  if (!byShare) {
    byShare = new Map()
    filesRead.set(db, byShare)
  }
  let files = byShare.get(shareId)
  if (!files) {
    files = new Set()
    byShare.set(shareId, files)
  }
  return files
}

/** `reason` null: a removed device's file, skipped without a problem. */
type Opened =
  | { ok: true; stamp: string; settings: Settings }
  | { ok: false; reason: SettingsProblem['reason'] | null }

/** Opens one settings file: its member must be one of this person's devices, and the file must name its own stamp. */
async function openSettingsFile(
  db: Database.Database,
  transport: SyncTransport,
  shareId: string,
  keys: { projectKey: KeySource },
  path: string,
  pathStamp: string
): Promise<Opened> {
  const memberKey = db.prepare(
    'SELECT public_key, removed_at FROM sync_members WHERE share_id = @shareId AND member_id = @memberId'
  )
  let removedWriter = false
  try {
    const { header, payload } = openEnvelope(
      SETTINGS_FILE,
      await transport.read(path),
      {
        projectKey: keys.projectKey,
        publicKeyFor: (memberId) => {
          const member = memberKey.get({ shareId, memberId }) as
            { public_key: string; removed_at: number | null } | undefined
          // A removed device's settings are no longer taken.
          removedWriter = member?.removed_at != null
          return member && !removedWriter ? member.public_key : null
        }
      },
      parseHeader
    )
    if (header.shareId !== shareId || header.stamp !== pathStamp) {
      return { ok: false, reason: 'mismatch' }
    }
    observeRemoteStamp(header.stamp)
    return { ok: true, stamp: header.stamp, settings: personalSettings(readSettings(payload)) }
  } catch (error) {
    if (removedWriter) return { ok: false, reason: null }
    return {
      ok: false,
      reason: error instanceof SettingsFileError ? error.reason : 'unreadable'
    }
  }
}

function parseHeader(raw: Record<string, unknown>): SettingsHeader {
  if (
    raw.formatVersion !== 1 ||
    typeof raw.memberId !== 'string' ||
    typeof raw.shareId !== 'string' ||
    typeof raw.stamp !== 'string'
  ) {
    throw new SettingsFileError('not-a-change-file')
  }
  return { memberId: raw.memberId, shareId: raw.shareId, stamp: raw.stamp }
}

function readSettings(payload: unknown): Settings {
  if (typeof payload !== 'object' || payload === null)
    throw new SettingsFileError('not-a-change-file')
  const settings = (payload as { settings?: unknown }).settings
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    throw new SettingsFileError('not-a-change-file')
  }
  return settings as Settings
}
