/**
 * Advanced sync's bucket on the phone: the settings from a setup code (r2-setup-code.ts), kept in
 * the phone's secure store (Android Keystore), never in the database, so they never sync and are
 * gone with the app. Listeners hear when they change, so the sync loop restarts on the new bucket.
 */
import * as SecureStore from 'expo-secure-store'
import { SPACE_FOLDER } from '../../../electron/services/sync/pairing'
import {
  checkedMinutes,
  DEFAULT_R2_CHECK_MINUTES,
  openR2Setup,
  sealR2Setup,
  newSetupPassphrase,
  type R2Setup
} from '../../../electron/services/sync/r2-setup-code'
import {
  checkedR2Config,
  R2Client,
  type R2Config
} from '../../../electron/services/sync/r2-transport'

const KEY = 'ostler.r2Setup'
const listeners = new Set<(setup: R2Setup | null) => void>()
let cached: R2Setup | null | undefined

export async function loadR2Setup(): Promise<R2Setup | null> {
  if (cached !== undefined) return cached
  try {
    const text = (await SecureStore.getItemAsync(KEY)) ?? builtInSetup()
    if (!text) {
      cached = null
      return null
    }
    const parsed = JSON.parse(text) as R2Setup
    cached = {
      config: checkedR2Config(parsed.config),
      space: parsed.space,
      checkMinutes: checkedMinutes(parsed.checkMinutes)
    }
  } catch {
    cached = null
  }
  return cached
}

/**
 * The bucket a test build was made with (`sideload-android.cjs --r2-config`), as setup JSON; null in
 * every other build. With it the app syncs from its first start, with nothing to type.
 */
function builtInSetup(): string | null {
  const built = process.env.EXPO_PUBLIC_OSTLER_BUILT_IN_R2
  if (!built) return null
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(built), (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

async function store(setup: R2Setup | null): Promise<void> {
  if (setup === null) await SecureStore.deleteItemAsync(KEY)
  else await SecureStore.setItemAsync(KEY, JSON.stringify(setup))
  cached = setup
  for (const listener of listeners) listener(setup)
}

/** Opens a setup code and keeps its bucket; throws `R2SetupCodeError`. */
export async function importR2Setup(code: string, passphrase: string): Promise<R2Setup> {
  const setup = openR2Setup(code, passphrase)
  await store(setup)
  return setup
}

/** The bucket details a person types in, rather than a setup code. */
export type R2Details = Pick<R2Config, 'accountId' | 'bucket' | 'accessKeyId' | 'secretAccessKey'>

/** The details as a checked config: trimmed, the whole bucket (no folder); throws `R2Error`. */
export function r2ConfigFrom(details: R2Details): R2Config {
  return checkedR2Config({
    accountId: details.accountId.trim().toLowerCase(),
    bucket: details.bucket.trim(),
    prefix: '',
    accessKeyId: details.accessKeyId.trim(),
    secretAccessKey: details.secretAccessKey.trim()
  })
}

/** Tries a listing in the bucket with these details; throws `R2Error` when it can't. */
export async function testR2Details(
  details: R2Details,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)
): Promise<void> {
  await new R2Client(r2ConfigFrom(details), { fetch: fetchImpl }).test()
}

/**
 * Keeps a bucket typed in by hand. Its personal space goes where a PC puts it (`Ostler` at the top
 * of the bucket), so either side can start it and the other finds it.
 */
export async function saveR2Details(details: R2Details): Promise<R2Setup> {
  const setup: R2Setup = {
    config: r2ConfigFrom(details),
    space: SPACE_FOLDER,
    checkMinutes: DEFAULT_R2_CHECK_MINUTES
  }
  await store(setup)
  return setup
}

export async function setR2CheckMinutes(minutes: number): Promise<void> {
  const setup = await loadR2Setup()
  if (setup) await store({ ...setup, checkMinutes: checkedMinutes(minutes) })
}

export async function forgetR2Setup(): Promise<void> {
  await store(null)
}

/** A new setup code for the saved bucket, and the passphrase that opens it. */
export async function exportR2Setup(): Promise<{ code: string; passphrase: string } | null> {
  const setup = await loadR2Setup()
  if (!setup) return null
  const passphrase = newSetupPassphrase()
  return { code: sealR2Setup(setup, passphrase), passphrase }
}

export function onR2SetupChanged(listener: (setup: R2Setup | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
