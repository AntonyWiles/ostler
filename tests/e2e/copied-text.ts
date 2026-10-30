import type { ElectronApplication } from 'playwright'
import {
  OFF_SCREEN_CLIPBOARD_KEY,
  type OffScreenClipboard
} from '../../src/shared/off-screen-clipboard'

/**
 * What Ostler last copied. An Ostler under Playwright runs off screen, where it
 * copies into a clipboard of its own and never the Windows one (the person's
 * stays as it was), so this reads that one; '' before anything was copied.
 */
export function copiedText(app: ElectronApplication): Promise<string> {
  return app.evaluate((_electron, key) => {
    const slots = globalThis as unknown as Record<symbol, OffScreenClipboard | undefined>
    return slots[Symbol.for(key)]?.text ?? ''
  }, OFF_SCREEN_CLIPBOARD_KEY)
}
