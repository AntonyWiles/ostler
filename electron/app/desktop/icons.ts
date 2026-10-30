import { app, nativeImage, type NativeImage } from 'electron'
import { join } from 'path'

/**
 * The app's icons (P8.2), rendered from build/icons/mark.svg by
 * `npm run icons`. A packaged app carries them in its resources folder
 * (package.json `build.extraResources`); a development run reads them from
 * the repository.
 */
export function iconsDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons')
    : join(app.getAppPath(), 'build', 'icons')
}

/** The multi-size icon, for the window, the tray and notifications. */
export function appIconPath(): string {
  return join(iconsDirectory(), 'icon.ico')
}

/** The icon at one of the rendered sizes. */
export function appIconImage(size: 16 | 32 | 48 | 256): NativeImage {
  return nativeImage.createFromPath(join(iconsDirectory(), `${size}x${size}.png`))
}

/** The taskbar's Inbox badge for a label from `badgeText` ("1" … "9", "9+"). */
export function badgeImage(label: string): NativeImage {
  return nativeImage.createFromPath(
    join(iconsDirectory(), `badge-${label.replace('+', 'plus')}.png`)
  )
}
