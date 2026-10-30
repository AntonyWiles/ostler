import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS, type WindowControl, type WindowState } from '@shared/ostler-api'
import { offScreen } from '../off-screen'

/**
 * The custom title bar's own Minimise, Maximise or Restore, and Close
 * (`WindowControls` in TitleBar.tsx), for the main window and every pop-out.
 */
export function windowState(win: BrowserWindow): WindowState {
  return { maximized: win.isMaximized(), fullScreen: win.isFullScreen() }
}

/**
 * The custom title bar's buttons, on the window that pressed them. Close is
 * the window's own close, so the main window's goes through the same
 * 'close' handler as Alt+F4: hidden to the tray in background mode, or a quit.
 */
export function controlWindow(win: BrowserWindow, control: WindowControl): void {
  if (win.isDestroyed()) return
  switch (control) {
    case 'minimize':
      win.minimize()
      return
    case 'toggle-maximize':
      if (win.isFullScreen()) win.setFullScreen(false)
      else if (win.isMaximized()) win.unmaximize()
      // Maximising an off-screen window would bring it onto a display.
      else if (!offScreen) win.maximize()
      return
    case 'close':
      win.close()
      return
  }
}

/** Tells the window's page when it is maximised, restored or full screen: the Maximise button's icon. */
export function watchWindowState(win: BrowserWindow): void {
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.ON_WINDOW_STATE, windowState(win))
  }
  win.on('maximize', send)
  win.on('unmaximize', send)
  win.on('restore', send)
  win.on('enter-full-screen', send)
  win.on('leave-full-screen', send)
}
