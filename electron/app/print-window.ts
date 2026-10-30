import { BrowserWindow } from 'electron'
import { join } from 'path'
import {
  encodeAppearanceArgument,
  encodeLocaleArgument,
  type InitialAppearance
} from '@shared/ostler-api'
import { currentLocale } from './locale'
import { appLog } from './logging'
import { offScreen, offScreenArguments } from './off-screen'
import { t } from '@shared/i18n'

const isDev = process.env.NODE_ENV === 'development' || !!process.env['ELECTRON_RENDERER_URL']

/** Printouts are light: paper is white, whatever the app's theme. */
const PRINT_APPEARANCE: InitialAppearance = {
  theme: 'light',
  density: 'comfortable',
  accent: 'ostler',
  windowsAccent: null,
  systemDark: false
}

/** The print page sets this on `<html>` once every row is on the page, or 'error'. */
const READY_SCRIPT = 'document.documentElement.dataset.printReady || ""'
const READY_TIMEOUT_MS = 30_000

/**
 * Renders a print route for printing (P6.1): a project view
 * (`printHashPath`) or my week (`myWeekHashPath`, N3.1b), in an offscreen window with the
 * main window's security settings and preload (sandboxed, isolated, no Node)
 * and the same page and CSP: only the route differs. The print route draws
 * the whole view, unvirtualised, in the light theme, with a header. The
 * window is closed whatever happens.
 */
export async function renderPrintWindow<T>(
  hash: string,
  use: (contents: Electron.WebContents) => Promise<T>
): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 1400,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      additionalArguments: [
        encodeAppearanceArgument(PRINT_APPEARANCE),
        encodeLocaleArgument(currentLocale()),
        ...offScreenArguments()
      ]
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' as const }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
    } else {
      await win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }
    await waitUntilReady(win.webContents)
    return await use(win.webContents)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

async function waitUntilReady(contents: Electron.WebContents): Promise<void> {
  const started = Date.now()
  for (;;) {
    const state = (await contents.executeJavaScript(READY_SCRIPT)) as string
    if (state === '1') return
    if (state === 'error') throw new Error(t('desktop:printWindow.viewCouldntPreparedPrinting'))
    if (Date.now() - started > READY_TIMEOUT_MS)
      throw new Error(t('desktop:printWindow.preparingViewPrintingTook'))
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/**
 * Opens the system print dialog for the page; resolves once it is printed or
 * cancelled. Off screen there is no dialog: it resolves as cancelled.
 */
export function printContents(contents: Electron.WebContents): Promise<boolean> {
  if (offScreen) {
    appLog.info('Off screen: held back the print dialog')
    return Promise.resolve(false)
  }
  return new Promise((resolve, reject) => {
    contents.print({ silent: false, printBackground: true }, (success, failureReason) => {
      if (success || failureReason === 'cancelled') resolve(success)
      else reject(new Error(t('desktop:printWindow.printingFailed', { failureReason })))
    })
  })
}

/** The page as an A4 PDF (Letter in the US), backgrounds included. */
export function pdfOf(contents: Electron.WebContents, locale: string): Promise<Buffer> {
  return contents.printToPDF({
    printBackground: true,
    pageSize: /-(US|CA|MX|PH)$/i.test(locale) ? 'Letter' : 'A4',
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
  })
}
