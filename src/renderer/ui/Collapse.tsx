import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type TransitionEvent
} from 'react'
import { motionMs } from './motion'
import { cx } from './cx'
import './Collapse.css'

export interface CollapseProps extends HTMLAttributes<HTMLDivElement> {
  /** Shown or folded away. While folded the content is not rendered. */
  open: boolean
  children?: ReactNode
}

type Phase = 'open' | 'opening' | 'closing' | 'closed'

/**
 * The part of a disclosure that shows and hides. It grows open and folds shut
 * (Collapse.css) where `{open && <div …>}` would appear and vanish, and still
 * unmounts its content once shut. `className`, `id` and the rest go on the
 * content element, so it replaces that `<div>` one for one. Only a change of
 * `open` animates: whatever is open on first render is simply there.
 */
export function Collapse({ open, children, className, ...rest }: CollapseProps) {
  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed')
  // Clips the content only while it moves, so focus rings and shadows show
  // once it has settled.
  const [moving, setMoving] = useState(false)
  const outerRef = useRef<HTMLDivElement | null>(null)

  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    const animate = motionMs('--motion-normal') > 0
    if (open) setPhase(phase === 'closed' && animate ? 'opening' : 'open')
    else setPhase(animate ? 'closing' : 'closed')
    setMoving(animate)
  }

  // Mounted shut: lay that out, then open, so the height has somewhere to grow from.
  useLayoutEffect(() => {
    if (phase !== 'opening') return
    void outerRef.current?.offsetHeight
    setPhase('open')
  }, [phase])

  const settle = () => {
    setMoving(false)
    setPhase((current) => (current === 'closing' ? 'closed' : current))
  }

  // A timer in case the transition never ends (interrupted, or not run).
  useEffect(() => {
    if (!moving) return
    const timer = window.setTimeout(
      () => {
        setMoving(false)
        setPhase((current) => (current === 'closing' ? 'closed' : current))
      },
      motionMs('--motion-normal') + 100
    )
    return () => window.clearTimeout(timer)
  }, [moving, phase])

  const onTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows')
      settle()
  }

  if (phase === 'closed') return null
  return (
    <div
      ref={outerRef}
      className={cx('ui-collapse', phase !== 'open' && 'is-shut', moving && 'is-moving')}
      onTransitionEnd={onTransitionEnd}
    >
      <div {...rest} className={cx('ui-collapse__content', className)}>
        {children}
      </div>
    </div>
  )
}
