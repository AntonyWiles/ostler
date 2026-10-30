import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { RendererConfig, RendererConfigUpdate } from '@shared/ostler-api'
import { Collapse, NumberField, Section, type NumberFieldProps } from '../../ui'
import { chevronClass, ChevronRight, Icon } from '../../ui/icons'
import { useSavedDraft } from '../../hooks/useSavedDraft'
import { settingsGroupLabel, type SettingsGroupId } from '../../navigation/registry'

/**
 * What every settings section shares: the config, one queued save through
 * `UPDATE_CONFIG`, and the "Saved" confirmation in the page header.
 */
export interface SettingsApi {
  config: RendererConfig
  /** Saves at once and shows "Saved", or the error. Resolves either way. */
  saveConfig(updates: RendererConfigUpdate): Promise<void>
  /** Replaces the config with one main returned from another call. */
  setConfig(config: RendererConfig): void
  /** Reads the settings again. */
  reloadConfig(): void
  /** Shows "Saved" after a change made through another call. */
  markSaved(): void
  /** Shows an error in the page header; null clears it. */
  setError(error: string | null): void
}

const SettingsContext = createContext<SettingsApi | null>(null)

export const SettingsProvider = SettingsContext.Provider

export function useSettings(): SettingsApi {
  const api = useContext(SettingsContext)
  if (!api) throw new Error('useSettings is used outside SettingsView')
  return api
}

/**
 * A titled group of settings rows inside a section. Its `id` is in
 * `SETTINGS_GROUPS` (registry.ts), which holds its heading and the words the
 * command palette finds it by. With a `fold` (what the group is set to now,
 * in a few words) the group is one line that opens in place, so a page of
 * settings reads at a glance and nothing is more than a click away.
 */
export function SettingsGroup({
  id,
  description,
  actions,
  fold,
  children
}: {
  id: SettingsGroupId
  description?: ReactNode
  actions?: ReactNode
  fold?: { summary: ReactNode }
  children?: ReactNode
}) {
  const title = settingsGroupLabel(id)
  const sectionRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (fold || bringIntoView !== id) return
    bringIntoView = null
    sectionRef.current?.scrollIntoView({ block: 'start' })
  }, [fold, id])
  if (fold) {
    return (
      <FoldingGroup
        id={id}
        title={title}
        description={description}
        actions={actions}
        summary={fold.summary}
      >
        {children}
      </FoldingGroup>
    )
  }
  return (
    <Section
      ref={sectionRef}
      title={title}
      description={description}
      actions={actions}
      headingLevel={3}
      className="ostler-settings-group"
    >
      <div className="ostler-settings-rows">{children}</div>
    </Section>
  )
}

const OPEN_KEY = 'ostler.settingsGroupsOpen'

/** The folding groups this viewer left open, remembered in localStorage. */
function openGroups(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

function rememberOpen(id: string, open: boolean): void {
  const others = openGroups().filter((other) => other !== id)
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open ? [...others, id] : others))
  } catch {
    // A per-viewer convenience: without storage the group simply starts closed.
  }
}

/**
 * Brings a group into view the next time its section shows, opening it if it
 * folds: for a link from elsewhere (the command palette, Customise board).
 */
export function openSettingsGroup(id: SettingsGroupId): void {
  rememberOpen(id, true)
  bringIntoView = id
}

/** The group a link asked for, scrolled to and focused once when it shows. */
let bringIntoView: string | null = null

function FoldingGroup({
  id,
  title,
  description,
  actions,
  summary,
  children
}: {
  id: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  summary: ReactNode
  children?: ReactNode
}) {
  const [open, setOpen] = useState(() => openGroups().includes(id))
  const toggle = () => {
    setOpen(!open)
    rememberOpen(id, !open)
  }
  const titleId = useId()
  const summaryId = useId()
  const bodyId = useId()
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (bringIntoView !== id) return
    bringIntoView = null
    toggleRef.current?.scrollIntoView({ block: 'start' })
    toggleRef.current?.focus({ preventScroll: true })
  }, [id])
  return (
    <section aria-labelledby={titleId} className="ostler-settings-group ostler-settings-fold">
      <h3 className="ostler-settings-fold__heading">
        <button
          ref={toggleRef}
          type="button"
          className="ostler-settings-fold__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-labelledby={titleId}
          aria-describedby={summaryId}
          onClick={toggle}
        >
          <span id={titleId} className="ostler-settings-fold__title">
            {title}
          </span>
          {/* What it is set to now: hidden while open, where the settings say it. */}
          <span id={summaryId} className="ostler-settings-fold__summary" hidden={open}>
            {summary}
          </span>
          <Icon icon={ChevronRight} className={chevronClass(open)} />
        </button>
      </h3>
      <Collapse open={open} id={bodyId} className="ostler-settings-fold__body">
        {(description || actions) && (
          <div className="ostler-settings-fold__intro">
            {description && <p className="ui-section__description">{description}</p>}
            {actions && <div className="ui-section__actions">{actions}</div>}
          </div>
        )}
        <div className="ostler-settings-rows">{children}</div>
      </Collapse>
    </section>
  )
}

/**
 * A number saved when the field loses focus or Enter is pressed, not on every
 * keystroke: ports restart servers and intervals restart timers.
 */
export function CommittedNumberField({
  value,
  onCommit,
  ...rest
}: Omit<NumberFieldProps, 'value' | 'onChange'> & {
  value: number
  onCommit(value: number): void
}) {
  const [draft, setDraft] = useSavedDraft<number | null>(value)
  const commit = (next: number | null) => {
    if (next === null || next === value) {
      setDraft(value)
      return
    }
    const clamped = Math.min(rest.max ?? Infinity, Math.max(rest.min ?? -Infinity, next))
    onCommit(clamped)
  }
  return (
    <NumberField
      {...rest}
      value={draft}
      onChange={setDraft}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit(draft)
      }}
    />
  )
}
