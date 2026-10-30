import { join } from 'path'
import { BrowserWindow, desktopCapturer, nativeImage, screen, type NativeImage } from 'electron'
import {
  encodeAppearanceArgument,
  encodeLocaleArgument,
  type InitialAppearance
} from '@shared/ostler-api'
import { snipHashPath, type SnipDisplay } from '@shared/snip'
import { offScreen, showOffScreen } from '../window'
import { offScreenArguments } from '../off-screen'
import { currentLocale } from '../locale'
import type { CapturedDisplay, SnipImage, SnipOverlays } from './snip'

const isDev = process.env.NODE_ENV === 'development' || !!process.env['ELECTRON_RENDERER_URL']

/** The overlay is drawn dark over the frozen picture, whatever the app's theme. */
const OVERLAY_APPEARANCE: InitialAppearance = {
  theme: 'dark',
  density: 'comfortable',
  accent: 'ostler',
  windowsAccent: null,
  systemDark: true
}

function toSnipDisplay(display: Electron.Display): SnipDisplay {
  return { id: display.id, bounds: { ...display.bounds }, scaleFactor: display.scaleFactor }
}

function wrap(image: NativeImage): SnipImage {
  return {
    getSize: () => image.getSize(),
    crop: (rect) => wrap(image.crop(rect)),
    resize: (options) => wrap(image.resize({ ...options, quality: 'good' })),
    toPNG: () => image.toPNG(),
    toDataURL: () => image.toDataURL(),
    toJPEG: (quality) => image.toJPEG(quality)
  }
}

/** A marked-up snip's PNG as a picture (N4.2b); null when Electron cannot read it. */
export function snipImageFromPng(png: Uint8Array): SnipImage | null {
  const image = nativeImage.createFromBuffer(
    Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  )
  return image.isEmpty() ? null : wrap(image)
}

/** The colour of an off-screen snip's picture, as BGRA bytes: Ostler's slate. */
const SYNTHETIC_PIXEL = [0x3b, 0x29, 0x1e, 0xff]

/**
 * Off screen, a display's "picture": one plain colour at the display's own
 * full resolution, made here. The real screen is never read.
 */
function syntheticCapture(display: Electron.Display): CapturedDisplay {
  const width = Math.round(display.bounds.width * display.scaleFactor)
  const height = Math.round(display.bounds.height * display.scaleFactor)
  const pixels = Buffer.alloc(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set(SYNTHETIC_PIXEL, offset)
  }
  // At scale 1, as desktopCapturer's thumbnails are: its size is its pixels.
  const image = nativeImage.createFromBitmap(pixels, { width, height })
  return { display: toSnipDisplay(display), image: wrap(image) }
}

/**
 * Every display's picture at its own full resolution and scale (N4.2a).
 * `desktopCapturer` fits each screen into one thumbnail size, so it is asked
 * for the largest display's pixels; the crop then uses each capture's own
 * size, so a display it scaled still crops right. Protected content (DRM
 * video) comes back black: that is Windows, not an error. Off screen
 * (`offScreen`) `desktopCapturer` is never asked: each display gets a
 * generated picture of its size instead, so a test never reads the screen.
 */
export async function captureDisplays(): Promise<CapturedDisplay[]> {
  const displays = screen.getAllDisplays()
  if (offScreen) return displays.map(syntheticCapture)
  const width = Math.max(...displays.map((d) => Math.round(d.bounds.width * d.scaleFactor)))
  const height = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  const captured: CapturedDisplay[] = []
  displays.forEach((display, index) => {
    const source =
      sources.find((entry) => entry.display_id === String(display.id)) ??
      (sources.length === displays.length ? sources[index] : undefined)
    if (!source || source.thumbnail.isEmpty()) return
    captured.push({ display: toSnipDisplay(display), image: wrap(source.thumbnail) })
  })
  return captured
}

/**
 * A frameless, always-on-top window over each display, on the snip route of
 * the same page, sandboxed like every Ostler window. Under a test driver the
 * overlays stay left of every display and never take the focus, as the main
 * window does (`offScreen`).
 */
export function openSnipOverlays(displays: SnipDisplay[], onGone: () => void): SnipOverlays {
  let closing = false
  const windows: BrowserWindow[] = []
  const cursor = screen.getCursorScreenPoint()
  const underCursor = screen.getDisplayNearestPoint(cursor).id
  for (const display of displays) {
    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: '#000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: [
          encodeAppearanceArgument(OVERLAY_APPEARANCE),
          encodeLocaleArgument(currentLocale()),
          ...offScreenArguments()
        ]
      }
    })
    windows.push(win)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' as const }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.on('closed', () => {
      if (!closing) onGone()
    })
    win.webContents.on('render-process-gone', () => {
      if (!closing) onGone()
    })
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      if (offScreen) return showOffScreen(win)
      // Windows places a window by the scale of the display it starts on: set it again.
      win.setBounds(display.bounds)
      if (display.id === underCursor) {
        win.show()
        win.focus()
      } else {
        win.showInactive()
      }
    })
    const hash = snipHashPath(display.id)
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }
  }
  return {
    close: () => {
      closing = true
      for (const win of windows) if (!win.isDestroyed()) win.destroy()
    }
  }
}

/** Hides `win` and resolves once it has gone; true when it was showing. */
export function hideForSnip(win: BrowserWindow | null): Promise<boolean> {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(fallback)
      // Windows animates a window away; give it a moment to leave the screen.
      setTimeout(() => resolve(true), 200)
    }
    const fallback = setTimeout(() => {
      win.removeListener('hide', done)
      resolve(true)
    }, 1000)
    win.once('hide', done)
    win.hide()
  })
}
