import type {
  AccentSetting,
  DensitySetting,
  StartPageSetting,
  ThemeSetting
} from '@shared/ostler-api'
import { useState, type KeyboardEvent } from 'react'
import { isValidHotkey, sameHotkey } from '@shared/ostler-api'
import { Button, Radio, RadioGroup, Select, Switch, TextField, useToast } from '../../../ui'
import { useOptionalTips } from '../../../tips/TipsProvider'
import { useFeatures } from '../../../navigation/features'
import { accentTokens } from '../../../ui/theme/accent'
import { useAppearance } from '../../../ui/theme/ThemeProvider'
import { SettingsGroup, useSettings } from '../settings-form'
import { CalendarsGroup } from './CalendarsGroup'
import { languageName, t } from '@shared/i18n'
import { formatList, formatTime } from '@shared/format'
import { LANGUAGE_SYSTEM } from '@shared/ostler-api'
import { useLocale } from '../../../i18n/LocaleProvider'
import { normalizeWorkingHours, parseClockTime } from '@shared/planning/time-blocks'

interface Choice<T extends string> {
  value: T
  label: string
}

const THEME_CHOICES: Choice<ThemeSetting>[] = [
  {
    value: 'system',
    get label() {
      return t('settings:general.system')
    }
  },
  {
    value: 'light',
    get label() {
      return t('settings:general.light')
    }
  },
  {
    value: 'dark',
    get label() {
      return t('settings:general.dark')
    }
  }
]

const DENSITY_CHOICES: Choice<DensitySetting>[] = [
  {
    value: 'comfortable',
    get label() {
      return t('settings:general.comfortable')
    }
  },
  {
    value: 'compact',
    get label() {
      return t('settings:general.compact')
    }
  }
]

const ACCENT_CHOICES: Choice<AccentSetting>[] = [
  {
    value: 'ostler',
    get label() {
      return t('settings:general.blue')
    }
  },
  {
    value: 'windows',
    get label() {
      return t('settings:general.windowsAccentColour')
    }
  }
]

const START_CHOICES: Choice<StartPageSetting>[] = [
  {
    value: 'home',
    get label() {
      return t('settings:general.home')
    }
  },
  {
    value: 'lastProject',
    get label() {
      return t('settings:general.projectHadOpenLast')
    }
  }
]

function ChoiceGroup<T extends string>({
  name,
  legend,
  hint,
  choices,
  value,
  onChange
}: {
  name: string
  legend: string
  hint?: string
  choices: Choice<T>[]
  value: T
  onChange(value: T): void
}) {
  return (
    <div className="ostler-settings-row">
      <RadioGroup legend={legend} orientation="horizontal">
        {choices.map((choice) => (
          <Radio
            key={choice.value}
            name={`settings-${name}`}
            value={choice.value}
            label={choice.label}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
        ))}
      </RadioGroup>
      {hint && <p className="ostler-settings-hint">{hint}</p>}
    </div>
  )
}

function choiceLabel<T extends string>(choices: Choice<T>[], value: T): string {
  return choices.find((choice) => choice.value === value)?.label ?? value
}

function onOff(on: boolean): string {
  return on ? t('settings:general.summary.on') : t('settings:general.summary.off')
}

/** "09:00" as this locale says a time of day: "9:00 am" or "09:00". */
function clockTime(value: string): string {
  const minutes = parseClockTime(value)
  if (minutes === null) return value
  return formatTime(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60))
}

/**
 * A key the person presses rather than types: Ctrl or Alt (and Shift if they
 * like) with a letter, digit or function key, as an accelerator. Tab still
 * moves on, and Escape puts the saved key back.
 */
function HotkeyField({
  label,
  hint,
  value,
  taken,
  disabled,
  onCommit
}: {
  label: string
  hint: string
  value: string
  /** Another system-wide key of Ostler's: this one cannot be the same (N4.2a). */
  taken?: string
  disabled?: boolean
  onCommit(value: string): void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return
    event.preventDefault()
    if (event.key === 'Escape') {
      setDraft(null)
      setError(null)
      return
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
    const key = /^Key([A-Z])$/.exec(event.code)?.[1] ?? /^Digit([0-9])$/.exec(event.code)?.[1]
    // Letters and digits by position, so Shift or a keyboard layout cannot change them.
    const name = key ?? event.key
    const parts = [
      ...(event.ctrlKey ? ['Ctrl'] : []),
      ...(event.altKey ? ['Alt'] : []),
      ...(event.shiftKey ? ['Shift'] : []),
      name.length === 1 ? name.toUpperCase() : name
    ]
    const accelerator = parts.join('+')
    setDraft(accelerator)
    if (!isValidHotkey(accelerator)) {
      setError(t('settings:general.useCtrlAltLetter'))
      return
    }
    if (taken && sameHotkey(accelerator, taken)) {
      setError(t('settings:general.notTheQuickAddKey'))
      return
    }
    setError(null)
    setDraft(null)
    if (accelerator !== value) onCommit(accelerator)
  }
  return (
    <TextField
      label={label}
      hint={hint}
      value={draft ?? value}
      error={error ?? undefined}
      disabled={disabled}
      readOnly
      onKeyDown={onKeyDown}
      onBlur={() => {
        setDraft(null)
        setError(null)
      }}
    />
  )
}

/** Settings › General › Windows (P8.2): the title bar, background mode, sign-in and the Quick add key. */
function WindowsGroup() {
  const { config, saveConfig } = useSettings()
  const features = useFeatures()
  const desktop = config.desktop
  const on = [
    desktop.nativeTitleBar && t('settings:general.summary.titleBar'),
    desktop.backgroundMode && t('settings:general.summary.background'),
    desktop.startAtLogin && t('settings:general.summary.startAtLogin'),
    desktop.quickAddHotkeyEnabled &&
      t('settings:general.summary.quickAdd', { key: desktop.quickAddHotkey }),
    desktop.snipHotkeyEnabled && t('settings:general.summary.snip', { key: desktop.snipHotkey })
  ].filter((part): part is string => !!part)
  return (
    <SettingsGroup
      id="windows"
      fold={{
        summary: on.length > 0 ? formatList(on, 'unit') : t('settings:general.summary.allOff')
      }}
    >
      <Switch
        label={t('settings:general.useStandardWindowsTitle')}
        hint={t('settings:general.showsWindowsOwnTitle')}
        checked={desktop.nativeTitleBar}
        onChange={(event) => void saveConfig({ desktop: { nativeTitleBar: event.target.checked } })}
      />
      <Switch
        label={
          features.agents
            ? t('settings:general.backgroundModeWithAgents')
            : t('settings:general.backgroundMode')
        }
        hint={t('settings:general.closingWindowHidesNotification')}
        checked={desktop.backgroundMode}
        onChange={(event) => void saveConfig({ desktop: { backgroundMode: event.target.checked } })}
      />
      <Switch
        label={t('settings:general.startWhenISign')}
        hint={
          desktop.backgroundMode
            ? t('settings:general.startsNotificationAreaWithout')
            : t('settings:general.opensWindowWhenSign')
        }
        checked={desktop.startAtLogin}
        onChange={(event) => void saveConfig({ desktop: { startAtLogin: event.target.checked } })}
      />
      <Switch
        label={t('settings:general.quickAddAnywhere')}
        hint={t('settings:general.keyOpensQuickAdd')}
        checked={desktop.quickAddHotkeyEnabled}
        onChange={(event) =>
          void saveConfig({ desktop: { quickAddHotkeyEnabled: event.target.checked } })
        }
      />
      <HotkeyField
        label={t('settings:general.quickAddKey')}
        hint={t('settings:general.selectBoxPressKeys')}
        value={desktop.quickAddHotkey}
        disabled={!desktop.quickAddHotkeyEnabled}
        onCommit={(quickAddHotkey) => void saveConfig({ desktop: { quickAddHotkey } })}
      />
      <Switch
        label={t('settings:general.snipAnywhere')}
        hint={t('settings:general.keyStartsSnip')}
        checked={desktop.snipHotkeyEnabled}
        onChange={(event) =>
          void saveConfig({ desktop: { snipHotkeyEnabled: event.target.checked } })
        }
      />
      <HotkeyField
        label={t('settings:general.snipKey')}
        hint={t('settings:general.snipKeyHint')}
        value={desktop.snipHotkey}
        taken={desktop.quickAddHotkey}
        disabled={!desktop.snipHotkeyEnabled}
        onCommit={(snipHotkey) => void saveConfig({ desktop: { snipHotkey } })}
      />
    </SettingsGroup>
  )
}

/**
 * Settings › General › Language (P11.1): "Match Windows" or a bundled
 * language, each in its own name. Main applies it at once, so the app re-renders
 * and the menus and tray rebuild without a restart.
 */
function LanguageGroup() {
  const { config, saveConfig } = useSettings()
  const { languages } = useLocale()
  const options = [
    { value: LANGUAGE_SYSTEM, label: t('settings:general.language.matchWindows') },
    ...languages.map((language) => ({ value: language, label: languageName(language) }))
  ]
  return (
    <SettingsGroup
      id="language"
      fold={{
        summary: options.find((option) => option.value === config.ui.language)?.label ?? ''
      }}
    >
      <div className="ostler-settings-row">
        <Select
          label={t('settings:general.language.label')}
          hint={t('settings:general.language.hint')}
          options={options}
          value={config.ui.language}
          onChange={(event) => void saveConfig({ ui: { language: event.target.value } })}
        />
      </div>
    </SettingsGroup>
  )
}

/**
 * Working hours (N3.4a, N28): the hours the Calendar's Week opens on; the
 * rest of the day is shaded. A time saves once it is a whole time after
 * (or, for the start, before) the other; anything else is not saved and says why.
 */
function WorkingHoursGroup() {
  const { config, saveConfig } = useSettings()
  const saved = normalizeWorkingHours(config.ui.workingHours)
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string | null>(null)
  const change = (part: 'start' | 'end', value: string) => {
    const next = { ...draft, [part]: value }
    setDraft(next)
    const start = parseClockTime(next.start)
    const end = parseClockTime(next.end)
    if (start === null || end === null) return
    if (end <= start) {
      setError(t('settings:general.workingHours.endAfterStart'))
      return
    }
    setError(null)
    if (next.start !== saved.start || next.end !== saved.end)
      void saveConfig({ ui: { workingHours: next } })
  }
  return (
    <SettingsGroup
      id="working-hours"
      description={t('settings:general.workingHours.description')}
      fold={{
        summary: t('settings:general.summary.workingHours', {
          start: clockTime(saved.start),
          end: clockTime(saved.end)
        })
      }}
    >
      <div className="ostler-settings-row">
        <TextField
          label={t('settings:general.workingHours.start')}
          type="time"
          step={900}
          className="settings-time-field"
          value={draft.start}
          onChange={(event) => change('start', event.target.value)}
        />
        <TextField
          label={t('settings:general.workingHours.end')}
          type="time"
          step={900}
          className="settings-time-field"
          value={draft.end}
          error={error ?? undefined}
          onChange={(event) => change('end', event.target.value)}
        />
      </div>
    </SettingsGroup>
  )
}

/**
 * Tips and tours: turn the tips off or on, take the walkthrough again, and
 * let tips closed with "Got it" or "Don't show again" show once more. The
 * walkthrough can be taken with tips off; only the ones that offer themselves stop.
 */
function TipsGroup() {
  const tips = useOptionalTips()
  const { markSaved } = useSettings()
  const { toast } = useToast()
  if (!tips) return null
  return (
    <SettingsGroup id="tips" fold={{ summary: onOff(tips.enabled) }}>
      <Switch
        label={t('settings:general.tips.show')}
        hint={t('settings:general.tips.hint')}
        checked={tips.enabled}
        onChange={(event) => void tips.setEnabled(event.target.checked).then(markSaved)}
      />
      <div className="ostler-settings-inline-actions">
        <Button onClick={tips.startTour}>{t('settings:general.tips.takeTour')}</Button>
        <Button
          variant="ghost"
          onClick={() =>
            void tips.resetDismissed().then(() =>
              toast({
                title: t('settings:general.tips.resetDone'),
                body: t('settings:general.tips.resetDoneBody')
              })
            )
          }
        >
          {t('settings:general.tips.reset')}
        </Button>
      </div>
    </SettingsGroup>
  )
}

/** Settings › General: appearance (P2.1), where the app opens, and Windows (P8.2). */
export function GeneralSection() {
  const { config, saveConfig, markSaved } = useSettings()
  const { theme, density, accent, resolvedTheme, windowsAccent, setAppearance } = useAppearance()
  const windowsAccentUnusable =
    accent === 'windows' && accentTokens(windowsAccent, resolvedTheme) === null

  // Appearance saves through the theme provider, so it applies at once.
  const saveAppearance = async (change: Parameters<typeof setAppearance>[0]) => {
    if (await setAppearance(change)) markSaved()
  }

  // Each group one line with what it is set to, opening in place.
  return (
    <div className="ostler-settings-folds">
      <SettingsGroup
        id="appearance"
        fold={{
          summary: formatList(
            [
              choiceLabel(THEME_CHOICES, theme),
              choiceLabel(DENSITY_CHOICES, density),
              choiceLabel(ACCENT_CHOICES, accent)
            ],
            'unit'
          )
        }}
      >
        <ChoiceGroup
          name="theme"
          legend={t('settings:general.theme')}
          hint={t('settings:general.systemFollowsWindowsLight')}
          choices={THEME_CHOICES}
          value={theme}
          onChange={(value) => void saveAppearance({ theme: value })}
        />
        <ChoiceGroup
          name="density"
          legend={t('settings:general.density')}
          hint={t('settings:general.compactMakesTextControls')}
          choices={DENSITY_CHOICES}
          value={density}
          onChange={(value) => void saveAppearance({ density: value })}
        />
        <ChoiceGroup
          name="accent"
          legend={t('settings:general.accentColour')}
          hint={
            windowsAccentUnusable
              ? t('settings:general.windowsAccentColourCan')
              : t('settings:general.windowsAccentColourDarkened')
          }
          choices={ACCENT_CHOICES}
          value={accent}
          onChange={(value) => void saveAppearance({ accent: value })}
        />
      </SettingsGroup>

      <LanguageGroup />

      <SettingsGroup
        id="start-up"
        fold={{ summary: choiceLabel(START_CHOICES, config.ui.startPage) }}
      >
        <ChoiceGroup
          name="start-page"
          legend={t('settings:general.whenStartsOpen')}
          hint={t('settings:general.archivedRemovedProjectOpens')}
          choices={START_CHOICES}
          value={config.ui.startPage}
          onChange={(startPage) => void saveConfig({ ui: { startPage } })}
        />
      </SettingsGroup>

      <WorkingHoursGroup />

      <SettingsGroup id="progress" fold={{ summary: onOff(config.ui.showProgress === true) }}>
        <Switch
          label={t('settings:general.progress.show')}
          hint={t('settings:general.progress.hint')}
          checked={config.ui.showProgress === true}
          onChange={(event) => void saveConfig({ ui: { showProgress: event.target.checked } })}
        />
      </SettingsGroup>

      <TipsGroup />

      <CalendarsGroup />

      <WindowsGroup />
    </div>
  )
}
