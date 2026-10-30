import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'
import { t } from '@shared/i18n'
import { normalizeTipsSettings, type TipsSettings } from '@shared/tips'
import { useOstler } from '../context/OstlerContext'
import { useOpenDemoProject } from '../hooks/useOpenDemoProject'
import { useConfig } from '../hooks/useConfig'
import { isSampleProject } from '../hooks/sample-project'
import { projectPath, settingsPath } from '../navigation/paths'
import { isProjectViewId } from '../navigation/registry'
import { Button, useAnnounce, useToast } from '../ui'
import { Coachmark } from './Coachmark'
import { readSkipped, writeSkipped } from './skipped'
import { canPointAt, tipsShouldWait } from './targets'
import {
  ONE_TIME_TIPS,
  resolveTarget,
  SAMPLE_TOUR,
  SAMPLE_TOUR_ID,
  TOUR_INVITE,
  type OneTimeTip
} from './catalog'

/** What Help, Settings and the command palette can ask of tips. */
export interface TipsApi {
  /** Tips on (the walkthrough can always be started by hand). */
  enabled: boolean
  /** Opens the sample project (making it if it is gone) and starts the walkthrough. */
  startTour: () => void
  setEnabled: (enabled: boolean) => Promise<void>
  /** Every tip and the walkthrough invitation can show again. */
  resetDismissed: () => Promise<void>
}

const TipsContext = createContext<TipsApi | null>(null)

/** How long a tip's target must be on the page before the tip appears: no tips mid-click. */
export const TIP_DELAY_MS = 1200
/** After one closes, the next waits at least this long, so tips never queue up in a row. */
export const TIP_COOLDOWN_MS = 8000
/** How long a walkthrough step waits for its target before moving on without it. */
const STEP_WAIT_MS = 3000
const POLL_MS = 300

type Showing =
  | { kind: 'invite'; target: Element }
  | { kind: 'tip'; tip: OneTimeTip; target: Element }
  | { kind: 'tour'; step: number; target: Element | null; focus: boolean }

/**
 * Tips and the walkthrough. While the sample project is open: first a small
 * invitation to a walkthrough, then, once that is answered, one-off tips the
 * first time each view is open, one at a time and never in a row (a tip marked
 * `anywhere` shows in every project, sample or not). Nothing is
 * modal and nothing is dimmed. Every one can be closed for now (X, until
 * Ostler restarts), for good ("Got it", "Don't show again"), or all of them
 * turned off (a link on each tip, and Settings › General). The walkthrough
 * can be started again from Help, the command palette and Settings.
 */
export function TipsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { projects } = useOstler()
  const openDemoProject = useOpenDemoProject()
  const { toast } = useToast()
  const announce = useAnnounce()

  const [settings, setSettings] = useState<TipsSettings | null>(null)
  const [showing, setShowing] = useState<Showing | null>(null)
  const [pendingTour, setPendingTour] = useState(false)
  // "Not now": until Ostler restarts, through a reload of the window too.
  const skipped = useRef<Set<string> | null>(null)
  if (skipped.current === null) skipped.current = readSkipped()
  const skip = useCallback((id: string) => {
    skipped.current?.add(id)
    if (skipped.current) writeSkipped(skipped.current)
  }, [])
  const quietUntil = useRef(0)

  const match = matchPath('/projects/:projectId/:view/*', location.pathname)
  const projectId = match?.params.projectId ?? null
  const view = match?.params.view && isProjectViewId(match.params.view) ? match.params.view : null
  const project = projectId ? projects.find((entry) => entry.id === projectId) : undefined
  const inSample = !!project && isSampleProject(project)

  const { config } = useConfig()
  useEffect(() => {
    if (config) setSettings(normalizeTipsSettings(config.ui?.tips))
  }, [config])

  const save = useCallback(async (next: TipsSettings) => {
    setSettings(next)
    const result = await window.ostlerAPI.updateConfig({ ui: { tips: next } })
    if (result.ok) setSettings(normalizeTipsSettings(result.value.ui?.tips))
  }, [])

  const dismissForGood = useCallback(
    (...ids: string[]) => {
      const fresh = ids.filter((id) => !settings?.dismissed.includes(id))
      if (!settings || fresh.length === 0) return
      void save({ ...settings, dismissed: [...settings.dismissed, ...fresh] })
    },
    [settings, save]
  )

  const close = useCallback(() => {
    quietUntil.current = Date.now() + TIP_COOLDOWN_MS
    setShowing(null)
  }, [])

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!settings) return
      if (!enabled) setShowing((now) => (now?.kind === 'tour' ? now : null))
      await save({ ...settings, enabled })
    },
    [settings, save]
  )

  const resetDismissed = useCallback(async () => {
    if (!settings) return
    skipped.current?.clear()
    writeSkipped(new Set())
    await save({ ...settings, dismissed: [] })
  }, [settings, save])

  const startTour = useCallback(() => {
    setShowing(null)
    setPendingTour(true)
    if (!inSample) void openDemoProject()
  }, [inSample, openDemoProject])

  // A walkthrough asked for from elsewhere starts once the sample project is open.
  useEffect(() => {
    if (!pendingTour || !inSample) return
    setPendingTour(false)
    setShowing({ kind: 'tour', step: 0, target: null, focus: true })
  }, [pendingTour, inSample])

  // Leaving the sample project puts away whatever is showing.
  useEffect(() => {
    if (inSample || pendingTour) return
    setShowing((now) => {
      if (now?.kind === 'tour') skip(SAMPLE_TOUR_ID)
      return null
    })
  }, [inSample, pendingTour, skip])

  const tourAnswered =
    !!settings &&
    (settings.dismissed.includes(SAMPLE_TOUR_ID) || !!skipped.current?.has(SAMPLE_TOUR_ID))

  // Choose what to offer next, while nothing shows: the invitation, then one-off tips.
  useEffect(() => {
    if (showing || pendingTour || !settings?.enabled) return
    let candidate: string | null = null
    let since = 0
    const timer = window.setInterval(() => {
      // Nothing is offered over work in hand, such as an open whiteboard.
      if (Date.now() < quietUntil.current || tipsShouldWait()) return
      let next: Showing | null = null
      let key: string | null = null
      if (inSample && !tourAnswered) {
        const target = resolveTarget(TOUR_INVITE.target)
        if (target) {
          next = { kind: 'invite', target }
          key = SAMPLE_TOUR_ID
        }
      } else {
        for (const tip of ONE_TIME_TIPS) {
          if (!inSample && !tip.anywhere) continue
          if (settings.dismissed.includes(tip.id) || skipped.current?.has(tip.id)) continue
          if (tip.view && tip.view !== view) continue
          const target = resolveTarget(tip.target)
          if (!target) continue
          next = { kind: 'tip', tip, target }
          key = tip.id
          break
        }
      }
      if (key !== candidate) {
        candidate = key
        since = Date.now()
        return
      }
      if (next && Date.now() - since >= TIP_DELAY_MS) setShowing(next)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [showing, pendingTour, inSample, settings, tourAnswered, view])

  // An invitation or tip goes (unsaved) when what it points at goes, or work in hand opens.
  useEffect(() => {
    if (!showing || showing.kind === 'tour') return
    const timer = window.setInterval(() => {
      if (!canPointAt(showing.target) || tipsShouldWait()) setShowing(null)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [showing])

  useEffect(() => {
    if (!showing || showing.kind === 'tour') return
    const title = showing.kind === 'invite' ? TOUR_INVITE.title() : showing.tip.title()
    announce(t('onboarding:tips.announce', { title }))
  }, [showing, announce])

  // The walkthrough: open the step's view, then find what it points at.
  const tourStep = showing?.kind === 'tour' ? showing.step : null
  const tourTarget = showing?.kind === 'tour' ? showing.target : null
  // The steps shown this time round: their views' one-off tips would only repeat them.
  const seenSteps = useRef(new Set<number>())
  // Which way the person is going, so a step that can't show is skipped that way.
  const travel = useRef<1 | -1>(1)
  useEffect(() => {
    if (tourStep === null) seenSteps.current.clear()
    else if (tourTarget) seenSteps.current.add(tourStep)
  }, [tourStep, tourTarget])
  const finishTour = useCallback(
    (completed: boolean) => {
      const covered = [...seenSteps.current].flatMap((step) => SAMPLE_TOUR[step].covers ?? [])
      dismissForGood(SAMPLE_TOUR_ID, ...covered)
      close()
      toast({
        title: completed ? t('onboarding:tips.tourDone') : t('onboarding:tips.tourClosed'),
        body: t('onboarding:tips.tourAgain')
      })
    },
    [dismissForGood, close, toast]
  )
  const goToStep = useCallback(
    (step: number) => {
      if (step >= SAMPLE_TOUR.length) {
        finishTour(true)
        return
      }
      setShowing((now) => {
        if (now?.kind !== 'tour' || now.step === step) return now
        travel.current = step < now.step ? -1 : 1
        return { kind: 'tour', step: Math.max(0, step), target: null, focus: true }
      })
    },
    [finishTour]
  )

  useEffect(() => {
    if (tourStep === null || !projectId) return
    const step = SAMPLE_TOUR[tourStep]
    if (step.view && step.view !== view) {
      navigate(projectPath(projectId, step.view))
      return
    }
    if (tourTarget && canPointAt(tourTarget)) {
      const timer = window.setInterval(() => {
        if (!canPointAt(tourTarget))
          setShowing((now) => (now?.kind === 'tour' ? { ...now, target: null } : now))
      }, POLL_MS)
      return () => window.clearInterval(timer)
    }
    const started = Date.now()
    const timer = window.setInterval(() => {
      const target = resolveTarget(step.target)
      if (target) {
        setShowing((now) =>
          now?.kind === 'tour' && now.step === tourStep ? { ...now, target } : now
        )
      } else if (Date.now() - started > STEP_WAIT_MS) {
        // Not on the page (a narrow window, a view turned off): carry on without it, once.
        window.clearInterval(timer)
        goToStep(tourStep === 0 ? 1 : tourStep + travel.current)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [tourStep, tourTarget, view, projectId, navigate, goToStep])

  const turnOff = useCallback(() => {
    void setEnabled(false)
    toast({
      title: t('onboarding:tips.turnedOff'),
      body: t('onboarding:tips.turnedOffBody'),
      action: { label: t('onboarding:tips.turnBackOn'), onClick: () => void setEnabled(true) },
      secondaryAction: {
        label: t('onboarding:tips.openSettings'),
        onClick: () => navigate(settingsPath('general'))
      }
    })
  }, [setEnabled, toast, navigate])

  const api = useMemo<TipsApi>(
    () => ({ enabled: settings?.enabled ?? true, startTour, setEnabled, resetDismissed }),
    [settings, startTour, setEnabled, resetDismissed]
  )

  let coachmark: ReactNode = null
  if (showing?.kind === 'invite') {
    coachmark = (
      <Coachmark
        target={showing.target}
        side={TOUR_INVITE.side}
        outline={TOUR_INVITE.outline}
        eyebrow={t('onboarding:tips.tourEyebrow')}
        title={TOUR_INVITE.title()}
        body={TOUR_INVITE.body()}
        closeLabel={t('onboarding:tips.close')}
        onClose={() => {
          skip(SAMPLE_TOUR_ID)
          close()
        }}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                skip(SAMPLE_TOUR_ID)
                close()
              }}
            >
              {t('onboarding:tips.notNow')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setShowing({ kind: 'tour', step: 0, target: null, focus: true })}
            >
              {t('onboarding:tips.showMeAround')}
            </Button>
          </>
        }
        footer={
          <button
            type="button"
            className="ostler-coachmark__link"
            onClick={() => {
              dismissForGood(SAMPLE_TOUR_ID)
              close()
            }}
          >
            {t('onboarding:tips.dontShowAgain')}
          </button>
        }
      />
    )
  } else if (showing?.kind === 'tip') {
    const tip = showing.tip
    coachmark = (
      <Coachmark
        target={showing.target}
        side={tip.side}
        pointers={tip.pointers}
        outline={tip.outline}
        eyebrow={t('onboarding:tips.tipEyebrow')}
        title={tip.title()}
        body={tip.body()}
        closeLabel={t('onboarding:tips.close')}
        onClose={() => {
          skip(tip.id)
          close()
        }}
        actions={
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              skip(tip.id)
              close()
            }}
          >
            {t('onboarding:tips.gotIt')}
          </Button>
        }
        footer={
          <>
            <button
              type="button"
              className="ostler-coachmark__link"
              onClick={() => {
                dismissForGood(tip.id)
                close()
              }}
            >
              {t('onboarding:tips.dontShowTipAgain')}
            </button>
            <button type="button" className="ostler-coachmark__link" onClick={turnOff}>
              {t('onboarding:tips.turnOffTips')}
            </button>
          </>
        }
      />
    )
  } else if (showing?.kind === 'tour' && showing.target) {
    const step = SAMPLE_TOUR[showing.step]
    coachmark = (
      <Coachmark
        key={showing.step}
        target={showing.target}
        side={step.side}
        pointers={step.pointers}
        outline={step.outline}
        eyebrow={t('onboarding:tips.tourEyebrow')}
        title={step.title()}
        body={step.body()}
        closeLabel={t('onboarding:tips.closeTour')}
        onClose={() => finishTour(false)}
        takeFocus={showing.focus}
        stepper={{
          index: showing.step,
          count: SAMPLE_TOUR.length,
          onBack: () => goToStep(showing.step - 1),
          onNext: () => goToStep(showing.step + 1),
          onGoTo: goToStep
        }}
      />
    )
  }

  return (
    <TipsContext.Provider value={api}>
      {children}
      {coachmark}
    </TipsContext.Provider>
  )
}

/** Tips where there are any: the main window's shell, not pop-outs or tests rendering one part. */
export function useOptionalTips(): TipsApi | null {
  return useContext(TipsContext)
}
