import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { homePath, projectPath } from '../navigation/paths'
import { TitleBar, useCustomTitleBar } from '../shell/TitleBar'
import { lazyNamed } from '../lib/lazy-named'

// Shown once per install, so it loads only when it shows (P9.1).
const Welcome = lazyNamed(() => import('./Welcome'), 'Welcome')

/**
 * Shows the first-run welcome (P8.1) instead of the app while
 * `ui.firstRunCompleted` is false, and the app once it is finished or
 * skipped: in the new project's Overview, or on Home.
 */
export function FirstRunGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const customTitleBar = useCustomTitleBar()
  const location = useLocation()
  const [state, setState] = useState<{
    phase: 'loading' | 'welcome' | 'leaving' | 'app'
    version: string
    /** Where the welcome sends you; the app appears once the router is there. */
    target?: string
  }>({ phase: 'loading', version: '' })

  // The router may apply a navigation after other state (it uses a
  // transition), so the app mounts only once it is at the target: otherwise
  // it would start at `/` and its own redirect would win.
  useEffect(() => {
    if (state.phase !== 'leaving') return
    const show = () => setState((current) => ({ ...current, phase: 'app' }))
    if (location.pathname === state.target) {
      show()
      return
    }
    // Never leave the window blank if the router lands somewhere else.
    const timer = setTimeout(show, 1000)
    return () => clearTimeout(timer)
  }, [state.phase, state.target, location.pathname])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [config, version] = await Promise.all([
        window.ostlerAPI.getConfig(),
        window.ostlerAPI.getAppVersion()
      ])
      if (cancelled) return
      // If the config can't be read, the app shows its own error; never trap
      // someone in the welcome.
      const welcome = config.ok && !config.value.ui.firstRunCompleted
      setState({ phase: welcome ? 'welcome' : 'app', version: version.ok ? version.value : '' })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.phase === 'loading' || state.phase === 'leaving') return null
  if (state.phase === 'welcome') {
    return (
      <div className="ostler-firstrun">
        {/* The window still needs its strip to be dragged (P8.2); no menu yet. */}
        {customTitleBar && <TitleBar where={{ project: null, label: null }} menu={false} />}
        <Suspense fallback={null}>
          <Welcome
            version={state.version}
            onDone={(projectId) => {
              const target = projectId ? projectPath(projectId, 'overview') : homePath()
              setState((current) => ({ ...current, phase: 'leaving', target }))
              navigate(target, { replace: true })
            }}
          />
        </Suspense>
      </div>
    )
  }
  return <>{children}</>
}
