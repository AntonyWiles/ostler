import { randomUUID } from 'node:crypto'
import type { LibraryItem } from '@shared/ostler-api'
import {
  cropToCapturePixels,
  displayAt,
  MIN_SNIP_SIZE,
  snipFileName,
  type SnipDisplay,
  type SnipOverlayPicture,
  type SnipPreview,
  type SnipRect,
  type SnipSelection
} from '@shared/snip'
import { isPng } from '@shared/markup'
import { t } from '@shared/i18n'

/**
 * Snip to task (N4.2a, N32). Only a person's press starts one: the Snip to
 * task key, the tray or the command palette. Ostler's own window goes first,
 * then every display is captured at its full resolution and an overlay with
 * the frozen picture covers each one. A dragged rectangle is cropped from
 * its display's capture, the captures are let go, and quick add opens with
 * the picture. The picture stays in memory until **Add** stores it in the
 * Library (`LibraryService.saveSnip`); Cancel, or a newer snip, drops it.
 * Nothing here sends anything anywhere.
 *
 * Electron is reached only through `SnipDependencies`, so the flow is
 * testable without a screen (`snip-electron.ts` is the real one).
 */

/** The parts of a `NativeImage` a snip uses. */
export interface SnipImage {
  getSize(): { width: number; height: number }
  crop(rect: SnipRect): SnipImage
  resize(options: { width?: number; height?: number }): SnipImage
  toPNG(): Uint8Array
  toDataURL(): string
  /** A smaller encoding for the overlay to draw; the crop is taken from the image itself. */
  toJPEG(quality: number): Uint8Array
}

export interface CapturedDisplay {
  display: SnipDisplay
  image: SnipImage
}

export interface SnipOverlays {
  /** Closes every overlay window; safe to call twice. */
  close(): void
}

export interface SnipDependencies {
  /** Every display and its picture, at full resolution. */
  capture(): Promise<CapturedDisplay[]>
  /** Shows an overlay over each display; `onGone` runs if one closes by itself. */
  openOverlays(displays: SnipDisplay[], onGone: () => void): SnipOverlays
  /**
   * Hides Ostler's window, resolving once it has gone, so it is not in the
   * picture: true when it was showing.
   */
  hideMainWindow(): Promise<boolean>
  /** Brings Ostler's window back, if it was hidden for the snip. */
  restoreMainWindow(): void
  /** Where the pointer is, in global DIP. */
  cursorPoint(): { x: number; y: number }
  /** A snip is ready: open quick add with it. */
  deliver(preview: SnipPreview): void
  /** Stores the picture in the Library and attaches it to the task. */
  save(
    projectId: string,
    workItemId: string,
    fileName: string,
    png: Uint8Array
  ): Promise<LibraryItem>
  /** A picture from PNG bytes: a marked-up snip (N4.2b). Null when they are not a picture. */
  imageFromPng(png: Uint8Array): SnipImage | null
  now(): Date
  warn(message: string): void
}

/** The thumbnail quick add shows: at most this many pixels on its longer side. */
const PREVIEW_MAX_EDGE = 480

interface Session {
  captures: Map<number, CapturedDisplay>
  overlays: SnipOverlays | null
  wasShown: boolean
}

export class SnipController {
  private session: Session | null = null
  private starting = false
  private pending: { id: string; image: SnipImage; takenAt: Date } | null = null
  private disposed = false

  constructor(private readonly deps: SnipDependencies) {}

  /** Whether a snip is being taken now (overlays up, or capturing). */
  get active(): boolean {
    return this.starting || this.session !== null
  }

  /** Starts a snip; a second press while one is open does nothing. */
  async start(): Promise<void> {
    if (this.disposed || this.active) return
    this.starting = true
    let wasShown = false
    try {
      wasShown = await this.deps.hideMainWindow()
      const captured = await this.deps.capture()
      if (this.disposed) return
      if (captured.length === 0) throw new Error('No display could be captured')
      const captures = new Map(captured.map((entry) => [entry.display.id, entry]))
      const session: Session = { captures, overlays: null, wasShown }
      this.session = session
      session.overlays = this.deps.openOverlays(
        captured.map((entry) => entry.display),
        () => this.cancel()
      )
    } catch (error) {
      // Ostler's window comes back to say what went wrong.
      this.end()
      if (!this.disposed) this.deps.restoreMainWindow()
      throw error
    } finally {
      this.starting = false
    }
  }

  /** The frozen picture an overlay draws, for the display it covers. */
  overlayPicture(displayId: number): SnipOverlayPicture {
    const entry = this.session?.captures.get(displayId)
    if (!entry) throw new Error(t('desktop:snip.alreadyUsed'))
    const { width, height } = entry.image.getSize()
    const jpeg = Buffer.from(entry.image.toJPEG(90))
    return { dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, width, height }
  }

  /**
   * The person chose: a rectangle on one display, or (Enter) the whole
   * display under the pointer. A drag too small to be a snip is ignored and
   * the overlays stay up.
   */
  select(selection: SnipSelection): boolean {
    const session = this.session
    if (!session) return false
    let entry: CapturedDisplay | undefined
    let rect: SnipRect
    if ('whole' in selection) {
      const displays = [...session.captures.values()]
      entry =
        displayAt(
          displays.map((captured) => ({ ...captured, bounds: captured.display.bounds })),
          this.deps.cursorPoint()
        ) ?? displays[0]
      rect = { x: 0, y: 0, width: entry.display.bounds.width, height: entry.display.bounds.height }
    } else {
      entry = session.captures.get(selection.displayId)
      rect = selection.rect
      if (!entry || !(rect.width >= MIN_SNIP_SIZE && rect.height >= MIN_SNIP_SIZE)) return false
    }
    const pixels = cropToCapturePixels(rect, entry.display, entry.image.getSize())
    if (!pixels) return false
    const image = entry.image.crop(pixels)
    this.end()
    this.pending = { id: randomUUID(), image, takenAt: this.deps.now() }
    this.deps.deliver(this.preview(this.pending.id))
    return true
  }

  /** Esc, a right click, a closed overlay, or an error: everything goes, nothing is kept. */
  cancel(): void {
    if (!this.session) return
    const wasShown = this.session.wasShown
    this.end()
    if (wasShown && !this.disposed) this.deps.restoreMainWindow()
  }

  /** What quick add shows of the waiting snip. */
  preview(snipId: string): SnipPreview {
    const pending = this.requirePending(snipId)
    const { width, height } = pending.image.getSize()
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height))
    const small =
      scale < 1
        ? pending.image.resize({
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale))
          })
        : pending.image
    return { snipId, thumbnail: small.toDataURL(), width, height }
  }

  /** Mark up (N4.2b): the waiting snip at its full resolution, as PNG bytes. */
  picture(snipId: string): Uint8Array {
    return this.requirePending(snipId).image.toPNG()
  }

  /**
   * Mark up's **Use this picture**: the marked-up PNG replaces the waiting
   * snip, keeping its id and when it was taken; the original pixels are let
   * go, so a blur cannot be undone in what Add saves.
   */
  replace(snipId: string, png: Uint8Array): SnipPreview {
    const pending = this.requirePending(snipId)
    if (!(png instanceof Uint8Array) || !isPng(png)) throw new Error('A marked-up snip is a PNG')
    const image = this.deps.imageFromPng(png)
    const size = image?.getSize()
    if (!image || !size || size.width <= 0 || size.height <= 0) {
      throw new Error('A marked-up snip is a PNG')
    }
    this.pending = { ...pending, image }
    return this.preview(snipId)
  }

  /** Add: the waiting snip is stored and attached to the task, then let go. */
  async save(projectId: string, workItemId: string, snipId: string): Promise<LibraryItem> {
    const pending = this.requirePending(snipId)
    const result = await this.deps.save(
      projectId,
      workItemId,
      snipFileName(pending.takenAt),
      pending.image.toPNG()
    )
    if (this.pending?.id === snipId) this.pending = null
    return result
  }

  /** Cancel in quick add: the snip is dropped, unsaved. An unknown id is a no-op. */
  discard(snipId: string): void {
    if (this.pending?.id === snipId) this.pending = null
  }

  /** On quit: every overlay closes and every picture goes. */
  dispose(): void {
    this.disposed = true
    this.end()
    this.pending = null
  }

  private requirePending(snipId: string): { id: string; image: SnipImage; takenAt: Date } {
    if (typeof snipId !== 'string' || this.pending?.id !== snipId) {
      throw new Error(t('desktop:snip.alreadyUsed'))
    }
    return this.pending
  }

  /** Closes the overlays and lets go of the full captures (tens of MB on 4K displays). */
  private end(): void {
    const session = this.session
    this.session = null
    if (!session) return
    session.captures.clear()
    try {
      session.overlays?.close()
    } catch (error) {
      this.deps.warn(`Could not close the snip overlays: ${String(error)}`)
    }
  }
}
