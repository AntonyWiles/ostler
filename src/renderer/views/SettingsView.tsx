import { useConfig } from '../hooks/useConfig'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSectionId,
  settingsSections,
  settingsSubsections,
  type SettingsSectionDefinition,
  type SettingsSectionId
} from '../navigation/registry'
import { settingsPath } from '../navigation/paths'
import { useFeatures, viewContext } from '../navigation/features'
import type { RendererConfigUpdate } from '@shared/ostler-api'
import { Icon, InlineAlert, Spinner } from '../ui'
import { ChevronRight, CircleCheck, chevronClass } from '../ui/icons'
import { SettingsProvider, type SettingsApi } from './settings/settings-form'
import { GeneralSection } from './settings/sections/GeneralSection'
import { ProjectsSection } from './settings/sections/ProjectsSection'
import { PeopleSection } from './settings/sections/PeopleSection'
import { NotificationsSection } from './settings/sections/NotificationsSection'
import { AiSection } from './settings/sections/AiSection'
import { AgentsSection } from './settings/sections/AgentsSection'
import { ConnectionsSection } from './settings/sections/ConnectionsSection'
import { DevicesSection } from './settings/sections/DevicesSection'
import { DataSection } from './settings/sections/DataSection'
import { AdvancedSection } from './settings/sections/AdvancedSection'
import { GitSection } from './settings/sections/GitSection'
import { AboutSection } from './settings/sections/AboutSection'
import { recordGettingStarted } from '../help/record-getting-started'
import './SettingsView.css'
import { t } from '@shared/i18n'

const SECTION_CONTENT: Record<SettingsSectionId, () => ReactNode> = {
  general: () => <GeneralSection />,
  projects: () => <ProjectsSection />,
  people: () => <PeopleSection />,
  notifications: () => <NotificationsSection />,
  ai: () => <AiSection />,
  agents: () => <AgentsSection />,
  connections: () => <ConnectionsSection />,
  devices: () => <DevicesSection />,
  data: () => <DataSection />,
  advanced: () => <AdvancedSection />,
  git: () => <GitSection />,
  about: () => <AboutSection />
}

/** How long "Saved" stays in the header after a change. */
const SAVED_MS = 2000

/** Settings at `/settings/:section`, one section at a time. */
export function SettingsView() {
  const { section } = useParams<{ section?: string }>()
  const navigate = useNavigate()
  const features = useFeatures()
  const sections = settingsSections(viewContext(features, null))
  const resolved = isSettingsSectionId(section) ? section : null
  const active: SettingsSectionId =
    resolved && sections.some((entry) => entry.id === resolved)
      ? resolved
      : DEFAULT_SETTINGS_SECTION

  // A section with sections under it is open in the menu while it or one of
  // them is on show.
  const activeParent = sections.find((entry) => entry.id === active)?.parent ?? null

  // "See where your backups are" on Home's getting-started checklist (P8.1).
  useEffect(() => {
    if (active === 'data') recordGettingStarted('sawBackups')
  }, [active])

  // Another window or main itself may change a setting (the agents switch
  // from the automation API, a project's order): useConfig stays current.
  const { config, setConfig, reload: reloadConfig, error: loadError } = useConfig()
  const [saveError, setError] = useState<string | null>(null)
  const error = saveError ?? loadError
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveQueue = useRef(Promise.resolve())

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    },
    []
  )

  const markSaved = useCallback(() => {
    setError(null)
    setSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), SAVED_MS)
  }, [])

  const saveConfig = useCallback(
    (updates: RendererConfigUpdate) => {
      // One at a time, in order, so a fast series of changes lands as made.
      const save = async () => {
        const result = await window.ostlerAPI.updateConfig(updates)
        if (result.ok) {
          setConfig(result.value)
          markSaved()
        } else {
          setSaved(false)
          setError(result.error)
        }
      }
      const queued = saveQueue.current.then(save, save)
      saveQueue.current = queued.catch(() => undefined)
      return queued
    },
    [markSaved]
  )

  if (section && resolved && resolved !== section) {
    return <Navigate to={settingsPath(resolved)} replace />
  }

  if (!config) {
    return (
      <div className="ostler-settings-loading">
        <Spinner label={t('settings:settingsView.loadingSettings')} />
      </div>
    )
  }

  const api: SettingsApi = { config, saveConfig, setConfig, reloadConfig, markSaved, setError }
  const activeEntry = sections.find((entry) => entry.id === active)
  /** A section's link; one with sections under it carries a chevron that turns as it opens. */
  const navLink = (entry: SettingsSectionDefinition, open?: boolean) => (
    <a
      href={`#${settingsPath(entry.id)}`}
      className="ostler-settings-nav-link"
      aria-current={entry.id === active ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault()
        navigate(settingsPath(entry.id))
      }}
    >
      <span className="ostler-settings-nav-label">{entry.label}</span>
      {open !== undefined && <Icon icon={ChevronRight} className={chevronClass(open)} />}
    </a>
  )

  return (
    <div className="ostler-settings">
      <nav className="ostler-settings-nav" aria-label={t('settings:settingsView.settingsSections')}>
        <h1 className="ostler-settings-nav-title">{t('settings:settingsView.settings')}</h1>
        <ul>
          {sections
            .filter((entry) => entry.parent === null)
            .map((entry) => {
              const children = settingsSubsections(sections, entry.id)
              const open = active === entry.id || activeParent === entry.id
              return (
                <li key={entry.id}>
                  {navLink(entry, children.length > 0 ? open : undefined)}
                  {children.length > 0 && open && (
                    <ul className="ostler-settings-nav-sub">
                      {children.map((child) => (
                        <li key={child.id}>{navLink(child)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
        </ul>
      </nav>

      {/* A region, not a second <main>: the shell's content area is the one
          main landmark (P9.2). */}
      <section className="ostler-settings-main" aria-labelledby="ostler-settings-heading">
        <header className="ostler-settings-header">
          <h2 id="ostler-settings-heading" className="ostler-settings-heading">
            {activeEntry?.label}
          </h2>
          <span className="ostler-settings-saved" role="status">
            {saved && (
              <>
                <Icon icon={CircleCheck} /> {t('settings:settingsView.saved')}
              </>
            )}
          </span>
        </header>
        {error && (
          <InlineAlert
            tone="danger"
            title={t('settings:settingsView.changeWasntSaved')}
            onDismiss={() => setError(null)}
          >
            {error}
          </InlineAlert>
        )}
        <SettingsProvider value={api}>
          <div className="ostler-settings-body">{SECTION_CONTENT[active]()}</div>
        </SettingsProvider>
      </section>
    </div>
  )
}
