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
import { useLocation } from 'react-router-dom'
import type { MovePinInput, PinKind, PinPlace, PinView } from '@shared/ostler-api'
import { PIN_SIDEBAR_MAX } from '@shared/ostler-api'
import { COUNTDOWN_MAX } from '@shared/planning/countdown'
import { parseAppPath } from '../navigation/paths'
import { useToast, type MenuEntry } from '../ui'
import { Hourglass, Pin, PinOff } from '../ui/icons'
import { CountdownLimitDialog } from './CountdownLimitDialog'
import { pinTitle } from './pin-display'
import { t } from '@shared/i18n'

/** Something a pin can point at, as a menu knows it. */
export interface PinTarget {
  kind: PinKind
  targetId: string
  projectId: string
  /** For the toasts: "Pinned Launch to the sidebar". */
  title: string
}

export interface PinsApi {
  /** False outside the shell (tests of single components): menus then offer no pins. */
  available: boolean
  /** The sidebar's pins, in order; empty until read. */
  sidebar: PinView[]
  /** A project's Overview pins, read for the project on screen; empty for others. */
  overview(projectId: string): PinView[]
  /** The pin of this target in this place, if there is one. */
  find(place: PinPlace, target: Pick<PinTarget, 'kind' | 'targetId' | 'projectId'>): PinView | null
  pin(place: PinPlace, target: PinTarget): Promise<PinView | null>
  /** Unpins, with undo in the toast. The item is not touched. */
  unpin(pin: PinView, title: string): Promise<void>
  move(pin: PinView, input: MovePinInput): Promise<void>
  /** Reads the pins again (after a change made elsewhere). */
  reload(): void
  /** Pin to sidebar / Unpin from sidebar, and for a project's items the Overview pair. */
  menuItems(target: PinTarget): MenuEntry[]
  /** Every countdown (N5.2b), in pin order; empty until read. */
  countdowns: PinView[]
  /**
   * Turns a pin's countdown on or off. With three already counting down, it
   * first asks which one to turn off.
   */
  setCountdown(pin: PinView, on: boolean): Promise<void>
  /** Show as countdown / Stop the countdown, for a pin of a dated task or milestone. */
  countdownItems(pin: PinView): MenuEntry[]
}

const noPins: PinsApi = {
  available: false,
  sidebar: [],
  overview: () => [],
  find: () => null,
  pin: async () => null,
  unpin: async () => {},
  move: async () => {},
  reload: () => {},
  menuItems: () => [],
  countdowns: [],
  setCountdown: async () => {},
  countdownItems: () => []
}

const PinsContext = createContext<PinsApi>(noPins)

export function usePins(): PinsApi {
  return useContext(PinsContext)
}

const sameTarget =
  (target: Pick<PinTarget, 'kind' | 'targetId' | 'projectId'>) =>
  (pin: PinView): boolean =>
    pin.kind === target.kind &&
    pin.targetId === target.targetId &&
    pin.projectId === target.projectId

function samePins(a: PinView[], b: PinView[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b)
}

/**
 * A pin that can count down: a task, milestone or goal of one's own
 * (N5.6b) that is there and has a date (N5.2b).
 */
export function canCountDown(pin: PinView): boolean {
  return (
    (pin.kind === 'task' || pin.kind === 'milestone' || pin.kind === 'personal-goal') &&
    pin.exists &&
    Boolean(pin.date)
  )
}

const sameItem = (a: PinView, b: PinView): boolean =>
  a.kind === b.kind && a.targetId === b.targetId && a.projectId === b.projectId

/**
 * Pins (N5.2a): the sidebar's pins and the Overview pins of the project on
 * screen, read in one call each and read again whenever main says something
 * Home shows changed (a pin, or a task's title). Every surface that pins or
 * unpins goes through here, so the sidebar, the Overview and the menus agree.
 */
export function PinsProvider({ children }: { children: ReactNode }) {
  const { toast, toastUndo } = useToast()
  const location = useLocation()
  const here = parseAppPath(location.pathname)
  const projectId = here && 'projectId' in here ? here.projectId : null
  const [sidebar, setSidebar] = useState<PinView[]>([])
  const [overviews, setOverviews] = useState<Record<string, PinView[]>>({})
  const [countdowns, setCountdowns] = useState<PinView[]>([])
  /** A fourth countdown waiting for the person to choose which to turn off. */
  const [choosing, setChoosing] = useState<PinView | null>(null)
  const projectRef = useRef(projectId)
  projectRef.current = projectId

  const reload = useCallback(() => {
    void window.ostlerAPI.listPins({ place: 'sidebar' }).then((result) => {
      // The same pins keep the same state: every card's menu reads this context.
      if (result.ok)
        setSidebar((current) => (samePins(current, result.value) ? current : result.value))
    })
    void window.ostlerAPI.listCountdowns().then((result) => {
      if (result.ok)
        setCountdowns((current) => (samePins(current, result.value) ? current : result.value))
    })
    const current = projectRef.current
    if (current) {
      void window.ostlerAPI.listPins({ place: 'overview', projectId: current }).then((result) => {
        if (result.ok)
          setOverviews((all) =>
            samePins(all[current] ?? [], result.value) ? all : { ...all, [current]: result.value }
          )
      })
    }
  }, [])

  useEffect(() => {
    reload()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') reload()
    })
  }, [reload, projectId])

  /** Sends a countdown change to main, with a toast either way. */
  const sendCountdown = useCallback(
    async (pinned: PinView, on: boolean, replacePinId?: string) => {
      const result = await window.ostlerAPI.setPinCountdown(pinned.id, {
        countdown: on,
        ...(replacePinId ? { replacePinId } : {})
      })
      if (!result.ok) {
        toast({ title: t('common:countdowns.couldntChange'), body: result.error, tone: 'danger' })
        return
      }
      toast({
        title: t(on ? 'common:countdowns.shown' : 'common:countdowns.hidden', {
          title: pinTitle(pinned)
        }),
        tone: 'success'
      })
      reload()
    },
    [toast, reload]
  )

  const setCountdown = useCallback(
    async (pinned: PinView, on: boolean) => {
      const others = countdowns.filter((entry) => !sameItem(entry, pinned))
      if (on && others.length >= COUNTDOWN_MAX) {
        setChoosing(pinned)
        return
      }
      await sendCountdown(pinned, on)
    },
    [countdowns, sendCountdown]
  )

  const api = useMemo<PinsApi>(() => {
    const list = (place: PinPlace, forProject: string) =>
      place === 'sidebar' ? sidebar : (overviews[forProject] ?? [])
    const find: PinsApi['find'] = (place, target) =>
      list(place, target.projectId).find(sameTarget(target)) ?? null

    const pin: PinsApi['pin'] = async (place, target) => {
      const result = await window.ostlerAPI.createPin({
        place,
        kind: target.kind,
        targetId: target.targetId,
        projectId: target.projectId
      })
      if (!result.ok) {
        toast({ title: t('common:pins.couldntPin'), body: result.error, tone: 'danger' })
        return null
      }
      const made = result.value
      // A dated task or milestone (N5.2b): the toast offers its countdown.
      const offer = canCountDown(made) && !made.done && !made.countdown
      toast({
        title: t(
          place === 'sidebar' ? 'common:pins.pinnedToSidebar' : 'common:pins.pinnedToOverview',
          {
            title: target.title
          }
        ),
        tone: 'success',
        ...(offer
          ? {
              body: t('common:countdowns.offerAfterPin'),
              action: {
                label: t('common:countdowns.show'),
                onClick: () => setCountdown(made, true)
              }
            }
          : {})
      })
      reload()
      return made
    }

    const unpin: PinsApi['unpin'] = async (pinned, title) => {
      const result = await window.ostlerAPI.deletePin(pinned.id)
      if (!result.ok) {
        toast({ title: t('common:pins.couldntUnpin'), body: result.error, tone: 'danger' })
        return
      }
      reload()
      toastUndo(t('common:pins.unpinned', { title }), async () => {
        await window.ostlerAPI.restorePin(result.value)
        reload()
      })
    }

    const move: PinsApi['move'] = async (pinned, input) => {
      // Shown at once; the read that follows confirms it.
      const apply = (pins: PinView[]) => {
        const rest = pins.filter((entry) => entry.id !== pinned.id)
        const anchor = input.beforeId ?? input.afterId
        let at = rest.length
        if (anchor) {
          const index = rest.findIndex((entry) => entry.id === anchor)
          if (index !== -1) at = input.beforeId ? index : index + 1
        }
        return [...rest.slice(0, at), pinned, ...rest.slice(at)]
      }
      if (pinned.place === 'sidebar') setSidebar(apply)
      else
        setOverviews((all) => ({ ...all, [pinned.projectId]: apply(all[pinned.projectId] ?? []) }))
      const result = await window.ostlerAPI.movePin(pinned.id, input)
      if (!result.ok)
        toast({ title: t('common:pins.couldntMove'), body: result.error, tone: 'danger' })
      reload()
    }

    const countdownItems: PinsApi['countdownItems'] = (pinned) => {
      if (!canCountDown(pinned)) return []
      const on = countdowns.some((entry) => sameItem(entry, pinned))
      return [
        {
          label: t(on ? 'common:countdowns.hide' : 'common:countdowns.show'),
          icon: Hourglass,
          onSelect: () => void setCountdown(pinned, !on)
        }
      ]
    }

    const menuItems: PinsApi['menuItems'] = (target) => {
      const entry = (place: PinPlace): MenuEntry => {
        const pinned = find(place, target)
        if (pinned)
          return {
            label: t(
              place === 'sidebar' ? 'common:pins.unpinFromSidebar' : 'common:pins.unpinFromOverview'
            ),
            icon: PinOff,
            onSelect: () => void unpin(pinned, target.title)
          }
        const full = place === 'sidebar' && sidebar.length >= PIN_SIDEBAR_MAX
        return {
          label: t(place === 'sidebar' ? 'common:pins.pinToSidebar' : 'common:pins.pinToOverview'),
          icon: Pin,
          disabled: full,
          hint: full ? t('common:pins.sidebarFull', { max: PIN_SIDEBAR_MAX }) : undefined,
          onSelect: () => void pin(place, target)
        }
      }
      // The item's menu offers its countdown while it is pinned (N5.2b).
      const pinned = find('sidebar', target) ?? find('overview', target)
      // A goal of one's own (N5.6b) is in no project, so it has no Overview to pin to.
      const places: PinPlace[] =
        target.kind === 'personal-goal' ? ['sidebar'] : ['sidebar', 'overview']
      return [...places.map(entry), ...(pinned ? countdownItems(pinned) : [])]
    }

    return {
      available: true,
      sidebar,
      overview: (forProject) => overviews[forProject] ?? [],
      find,
      pin,
      unpin,
      move,
      reload,
      menuItems,
      countdowns,
      setCountdown,
      countdownItems
    }
  }, [sidebar, overviews, countdowns, toast, toastUndo, reload, setCountdown])

  return (
    <PinsContext.Provider value={api}>
      {children}
      <CountdownLimitDialog
        pin={choosing}
        countdowns={countdowns}
        onClose={() => setChoosing(null)}
        onChoose={(off) => {
          const on = choosing
          setChoosing(null)
          if (on) void sendCountdown(on, true, off.id)
        }}
      />
    </PinsContext.Provider>
  )
}

/** The pin entries for the end of an item's menu, after a separator; none outside the shell. */
export function pinEntries(pins: PinsApi, target: PinTarget): MenuEntry[] {
  if (!pins.available) return []
  const items = pins.menuItems(target)
  return items.length > 0 ? [{ type: 'separator' }, ...items] : []
}
