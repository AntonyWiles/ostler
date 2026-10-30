import { clipboard } from 'electron'
import { OFF_SCREEN_CLIPBOARD_KEY, type OffScreenClipboard } from '@shared/off-screen-clipboard'
import { offScreen } from './off-screen'
import { appLog } from './logging'

/** Off screen, the clipboard of Ostler's own, on main's `globalThis` so a test can read it. */
function heldClipboard(): OffScreenClipboard {
  const slots = globalThis as unknown as Record<symbol, OffScreenClipboard | undefined>
  const key = Symbol.for(OFF_SCREEN_CLIPBOARD_KEY)
  slots[key] ??= { text: '' }
  return slots[key]
}

/**
 * The one way Ostler copies text: Copy, a prompt with its token, Copy
 * diagnostics, a task's ID or branch name, and off screen the copy and cut
 * keys in its pages (`preload-clipboard.ts`). On screen it goes to the Windows
 * clipboard; off screen (`offScreen`) to Ostler's own, so a test or agent run
 * never changes what the person copied.
 */
export function copyText(text: string): void {
  if (offScreen) {
    heldClipboard().text = text
    // The length only: a prompt carries its session's token.
    appLog.info(`Off screen: copied ${text.length} characters to Ostler's own clipboard`)
    return
  }
  clipboard.writeText(text)
}

/** Off screen, the text Ostler last copied (its own clipboard); '' before any copy. */
export function offScreenCopiedText(): string {
  return heldClipboard().text
}

/** What the clipboard holds that the Library can keep (`readClipboard`). */
export interface ClipboardContents {
  /** A picture, as PNG. */
  image: Buffer | null
  /** A file copied in File Explorer: its path. */
  filePath: string | null
  text: string
}

/**
 * The one way Ostler reads the clipboard: a picture, a copied file or text,
 * for Paste into the Library or a task. Only when the person asks. Off
 * screen (`offScreen`) it reads Ostler's own clipboard, text only, and never
 * the Windows one.
 */
export function readClipboard(): ClipboardContents {
  if (offScreen) return { image: null, filePath: null, text: heldClipboard().text }
  const picture = clipboard.readImage()
  return {
    image: picture.isEmpty() ? null : picture.toPNG(),
    filePath: copiedFilePath(),
    text: clipboard.readText()
  }
}

/** The file File Explorer put on the clipboard (Windows' FileNameW), or null. */
function copiedFilePath(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const raw = clipboard.readBuffer('FileNameW')
    const path = raw.toString('utf16le').replace(/\0.*$/s, '').trim()
    return path || null
  } catch {
    return null
  }
}
