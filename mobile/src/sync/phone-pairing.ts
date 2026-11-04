/**
 * "Set up from my other device": the phone's half of pairing (people-and-devices D16, mobile plan
 * prompt 10). The phone is always the new device. It finds Ostler's folder in the person's Drive,
 * writes a signed request into `devices/requests/`, shows the six-digit code and waits for a PC
 * that is already paired to allow it. Then it reads the certificate and the wrapped keys, stores
 * the person's keys, joins the personal share and hands it to `PhoneSync`, so the projects the
 * person's other devices list there arrive by themselves.
 *
 * All of the protocol is `electron/services/sync/pairing.ts` (a core file, unchanged on the wire);
 * this file only finds the folder, waits and reports. No React Native imports, so the desktop's
 * Vitest runs it against a fake Drive (`tests/unit/mobile-pairing.test.ts`). Keys and codes are never
 * logged: only the reason a step failed.
 */
import type { DriveClient } from '../../../electron/services/sync/drive-client'
import { driveLocation } from '../../../electron/services/sync/drive-transport'
import type { SyncTransport } from '../../../electron/services/sync/folder-transport'
import {
  completePairing,
  DEVICES_FOLDER,
  PERSONAL_FOLDER,
  pairingCodeInSpace,
  PersonalSpaceError,
  personalShareOf,
  requestPairing
} from '../../../electron/services/sync/pairing'
import { joinPlace, readShareFile } from '../../../electron/services/sync/sharing'
import { BRAND } from '../../../src/shared/brand'
import type { SyncDatabase } from './phone-sync'

export type PairingPhase = 'idle' | 'looking' | 'waiting' | 'paired' | 'failed'

/** Why pairing stopped; each has a `mobile:pairing.errors.*` string. */
export type PairingFailure = 'no-space' | 'bad-keys' | 'failed'

export interface PairingState {
  phase: PairingPhase
  /** The six-digit code to compare with the one the PC shows; null until the space has a certificate to take it from. */
  code: string | null
  failure: PairingFailure | null
}

export interface PhonePairingOptions {
  db: SyncDatabase
  /** Only the Drive call that finds a folder in My Drive's root (when `findSpace` isn't given). */
  client?: Pick<DriveClient, 'findInRoot'>
  /** Advanced sync: finds the personal space somewhere else (an R2 bucket); null when it isn't there. */
  findSpace?(): Promise<string | null>
  /** Opens a Drive place (`gdrive:<folderId>/…`) as a transport. */
  openTransport(place: string): SyncTransport
  /** This phone's name as the PC lists it in the allow notice. */
  deviceName: string
  /** Called once, when the personal share is joined: the app hands it to `PhoneSync`. */
  onPaired(): void
  log(message: string, error?: unknown): void
  /** How often the devices folder is read when Drive has not said anything changed; default 5 s. */
  pollMs?: number
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
}

const DEFAULT_POLL_MS = 5000

/** The reason key for a pairing failure, as `t()` takes it. */
export function pairingErrorKey(failure: PairingFailure): string {
  switch (failure) {
    case 'no-space':
      return 'mobile:pairing.errors.noSpace'
    case 'bad-keys':
      return 'mobile:pairing.errors.badKeys'
    default:
      return 'mobile:pairing.errors.failed'
  }
}

export class PhonePairing {
  private current: PairingState
  private readonly listeners = new Set<(state: PairingState) => void>()
  private space: string | null = null
  private timer: unknown = null
  private stopWatch: (() => void) | null = null
  private ticking = false
  /** Bumped by `start` and `cancel`, so a step that was running when the person left stops quietly. */
  private run = 0

  constructor(private readonly options: PhonePairingOptions) {
    this.current = {
      phase: personalShareOf(options.db) ? 'paired' : 'idle',
      code: null,
      failure: null
    }
  }

  state(): PairingState {
    return this.current
  }

  /** Calls `listener` after every change of state; returns the way to stop. */
  subscribe(listener: (state: PairingState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Finds Ostler's folder, writes the request and starts waiting for a PC to allow it. Starting
   * again after a failure tries from the top; the request file is written once and left alone.
   */
  async start(): Promise<void> {
    if (personalShareOf(this.options.db)) {
      this.update({ phase: 'paired', code: null, failure: null })
      return
    }
    this.cancel()
    const run = this.run
    this.update({ phase: 'looking', code: null, failure: null })
    try {
      const space = await this.findSpace()
      if (run !== this.run) return
      if (!space) {
        this.update({ phase: 'failed', code: null, failure: 'no-space' })
        return
      }
      this.space = space
      await requestPairing(
        this.options.db,
        space,
        this.options.deviceName,
        this.options.openTransport
      )
      if (run !== this.run) return
      this.update({ phase: 'waiting', code: null, failure: null })
      this.watch(space)
      await this.tick(run)
    } catch (error) {
      if (run !== this.run) return
      this.fail(error)
    }
  }

  /** Looks at the devices folder now, instead of waiting for Drive or the timer; resolves when that look is done. */
  async check(): Promise<void> {
    await this.tick(this.run)
  }

  /** Stops waiting. The request stays in Drive; a PC that allows it later is picked up when the person starts again. */
  cancel(): void {
    this.run += 1
    this.stopTimers()
    if (this.current.phase === 'looking' || this.current.phase === 'waiting') {
      this.update({ phase: 'idle', code: null, failure: null })
    }
  }

  // ─── Steps ──────────────────────────────────────────────────────────────

  /** Ostler's folder in the root of My Drive (the oldest if there are several), when it holds a personal space. */
  private async findSpace(): Promise<string | null> {
    if (this.options.findSpace) return this.options.findSpace()
    if (!this.options.client) return null
    const roots = await this.options.client.findInRoot(BRAND.name)
    const oldest = [...roots].sort((a, b) => a.createdTime.localeCompare(b.createdTime))[0]
    if (!oldest) return null
    const space = driveLocation(oldest.id)
    try {
      await readShareFile(this.options.openTransport(joinPlace(space, PERSONAL_FOLDER)))
    } catch {
      return null
    }
    return space
  }

  private watch(space: string): void {
    try {
      this.stopWatch = this.options
        .openTransport(joinPlace(space, DEVICES_FOLDER))
        .watch(() => void this.tick(this.run))
    } catch (error) {
      // The timer still reads the folder.
      this.options.log('Could not watch the devices folder in Drive:', error)
    }
  }

  /** One look at the devices folder: the code once there is a certificate, the pairing once the keys are there. */
  private async tick(run: number): Promise<void> {
    if (this.ticking || run !== this.run || !this.space) return
    this.ticking = true
    try {
      const code =
        this.current.code ??
        (await pairingCodeInSpace(this.options.db, this.space, this.options.openTransport))
      if (run !== this.run) return
      if (code !== this.current.code) this.update({ ...this.current, code })
      const result = await completePairing(this.options.db, this.space, this.options.openTransport)
      if (run !== this.run) return
      if (result === 'paired') {
        this.stopTimers()
        this.update({ phase: 'paired', code: null, failure: null })
        this.options.onPaired()
        return
      }
    } catch (error) {
      if (run !== this.run) return
      if (error instanceof PersonalSpaceError) {
        this.fail(error)
        return
      }
      // Probably the connection: say so in the log and look again.
      this.options.log('Waiting for the other device did not work yet:', error)
    } finally {
      this.ticking = false
    }
    if (run === this.run && this.current.phase === 'waiting') this.schedule(run)
  }

  private schedule(run: number): void {
    if (this.timer !== null) this.clear(this.timer)
    this.timer = (this.options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
      this.timer = null
      void this.tick(run)
    }, this.options.pollMs ?? DEFAULT_POLL_MS)
  }

  private fail(error: unknown): void {
    this.stopTimers()
    const keys =
      error instanceof PersonalSpaceError && ['bad-keys', 'wrong-folder'].includes(error.reason)
    this.options.log('Pairing stopped:', error instanceof PersonalSpaceError ? error.reason : error)
    this.update({ phase: 'failed', code: null, failure: keys ? 'bad-keys' : 'failed' })
  }

  private stopTimers(): void {
    if (this.timer !== null) this.clear(this.timer)
    this.timer = null
    this.stopWatch?.()
    this.stopWatch = null
  }

  private clear(handle: unknown): void {
    if (this.options.clearTimer) this.options.clearTimer(handle)
    else clearTimeout(handle as ReturnType<typeof setTimeout>)
  }

  private update(next: PairingState): void {
    this.current = next
    for (const listener of this.listeners) listener(next)
  }
}
