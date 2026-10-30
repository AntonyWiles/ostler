import { useEffect, useRef, useState } from 'react'
import { BRAND } from '@shared/brand'
import { TITLE_BAR_HEIGHT, type WindowControl, type WindowState } from '@shared/ostler-api'
import markUrl from '../../../build/icons/mark.svg?url'
import { IconButton, Tooltip } from '../ui'
import { AppMenu, Copy, Icon, Minus, Square, X, type LucideIcon } from '../ui/icons'
import type { WhereAmI } from './useWhereAmI'
import './TitleBar.css'
import { t } from '@shared/i18n'
import { ProjectMark } from '../components/ProjectMark'
import { UndoRedoControls } from '../history/UndoRedoControls'

/**
 * Whether this window draws its own title bar (Settings › General: "Use the
 * standard Windows title bar" off). Read once: the setting applies when the
 * window opens.
 */
export function useCustomTitleBar(): boolean {
  const [custom, setCustom] = useState(false)
  useEffect(() => {
    let cancelled = false
    void window.ostlerAPI
      .getWindowChrome?.()
      .then((result) => {
        if (!cancelled && result?.ok) setCustom(result.value.customTitleBar)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return custom
}

/**
 * Marks the window's top strip as chrome while a title bar is shown: every
 * overlay (backdrops, menus, tooltips, tips) starts below `--title-bar-height`,
 * so the strip still drags the window and its Minimise, Maximise and Close
 * are never covered or dimmed.
 */
export function useReserveTitleBar(): void {
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--title-bar-height', `${TITLE_BAR_HEIGHT}px`)
    return () => {
      root.style.removeProperty('--title-bar-height')
    }
  }, [])
}

/**
 * The window's top strip (P8.2): the app icon, a menu button that pops up the
 * application menu, Undo, Redo and the undo history, where the person is, and
 * the window's Minimise, Maximise and Close. The strip drags the window; the
 * buttons do not.
 */
export function TitleBar({ where, menu = true }: { where: WhereAmI; menu?: boolean }) {
  const menuButton = useRef<HTMLButtonElement>(null)
  useReserveTitleBar()
  const openMenu = () => {
    const box = menuButton.current?.getBoundingClientRect()
    if (!box) return
    void window.ostlerAPI.popupAppMenu({ x: box.left, y: box.bottom })
  }
  const place = [where.project?.name, where.workstream, where.label].filter(Boolean).join(' › ')
  return (
    <header className="ostler-titlebar">
      <img className="ostler-titlebar-icon" src={markUrl} alt="" draggable={false} />
      {menu && (
        <IconButton
          ref={menuButton}
          className="ostler-titlebar-menu"
          icon={AppMenu}
          label={t('navigation:titleBar.menu')}
          size="sm"
          aria-haspopup="menu"
          onClick={openMenu}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              openMenu()
            }
          }}
        />
      )}
      <UndoRedoControls className="ostler-titlebar-undo" />
      <p className="ostler-titlebar-title">
        {place ? (
          <>
            {where.project?.icon && <ProjectMark project={where.project} />}
            <span className="ostler-titlebar-place">{place}</span>
            <span className="ostler-titlebar-app"> · {BRAND.name}</span>
          </>
        ) : (
          BRAND.name
        )}
      </p>
      <WindowControls />
    </header>
  )
}

/** Whether this window is maximised or full screen, kept current as it changes. */
function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({ maximized: false, fullScreen: false })
  useEffect(() => {
    let cancelled = false
    void window.ostlerAPI
      .getWindowState?.()
      .then((result) => {
        if (!cancelled && result?.ok) setState(result.value)
      })
      .catch(() => {})
    const unsubscribe = window.ostlerAPI.onWindowState?.(setState)
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])
  return state
}

/**
 * Minimise, Maximise or Restore, and Close at the title bar's right end, in
 * place of Windows' own. Close is the window's own close: the main window's
 * hides to the tray in background mode, as Alt+F4 does. Drawn only while this
 * window has the custom title bar, so a pop-out under Windows' title bar
 * shows Windows' buttons alone.
 */
export function WindowControls() {
  const custom = useCustomTitleBar()
  const { maximized, fullScreen } = useWindowState()
  if (!custom) return null
  const restore = maximized || fullScreen
  return (
    <div className="ostler-window-controls">
      <WindowControlButton
        control="minimize"
        icon={Minus}
        label={t('navigation:titleBar.minimize')}
      />
      <WindowControlButton
        control="toggle-maximize"
        icon={restore ? Copy : Square}
        label={t(restore ? 'navigation:titleBar.restore' : 'navigation:titleBar.maximize')}
      />
      <WindowControlButton control="close" icon={X} label={t('navigation:titleBar.close')} />
    </div>
  )
}

function WindowControlButton({
  control,
  icon,
  label
}: {
  control: WindowControl
  icon: LucideIcon
  label: string
}) {
  return (
    <Tooltip content={label} describe={false}>
      <button
        type="button"
        aria-label={label}
        className={`ostler-window-control ostler-window-control--${control}`}
        onClick={() => void window.ostlerAPI.windowControl(control)}
      >
        <Icon icon={icon} className="ostler-window-control-icon" />
      </button>
    </Tooltip>
  )
}
