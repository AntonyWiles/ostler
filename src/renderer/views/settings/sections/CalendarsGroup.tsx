import { useState } from 'react'
import {
  MAX_CALENDAR_NAME,
  type ChosenCalendarFile,
  type OutsideCalendar
} from '@shared/ostler-api'
import { PROJECT_COLORS } from '@shared/project-colors'
import { formatDateTime, formatRelativeTime } from '@shared/format'
import { t } from '@shared/i18n'
import { useCalendars } from '../../../context/CalendarsContext'
import { Badge, Button, Dialog, TextField, useToast } from '../../../ui'
import { ProjectColorPicker } from '../../../components/ProjectColorPicker'
import { CalendarLinkDialog } from './CalendarLinkDialog'
import { AccountCalendarDialog } from './AccountCalendarDialog'
import { CopyTargetRow, TIME_BLOCKS_INTO_CALENDAR } from './CopyTargetRow'
import { useAccountsWith } from '../../../accounts/useAccountsWith'
import { SettingsGroup, useSettings } from '../settings-form'
import './CalendarsGroup.css'

/** "120 events read, 3 skipped, 2 repeats shown once". */
export function calendarCounts(
  counts: Pick<OutsideCalendar, 'readCount' | 'skippedCount' | 'shownOnceCount'>
): string {
  return [
    t('settings:calendars.read', { count: counts.readCount }),
    counts.skippedCount > 0
      ? t('settings:calendars.skipped', { count: counts.skippedCount })
      : null,
    counts.shownOnceCount > 0
      ? t('settings:calendars.shownOnce', { count: counts.shownOnceCount })
      : null
  ]
    .filter(Boolean)
    .join(', ')
}

/** A link calendar's last update: "updated 5 minutes ago", or "not updated yet". */
export function linkUpdatedText(calendar: OutsideCalendar, now = Date.now()): string {
  return calendar.fetchedAt
    ? t('settings:calendars.updated', { when: formatRelativeTime(calendar.fetchedAt, now) })
    : t('settings:calendars.neverUpdated')
}

/**
 * Settings › General › Calendars (N3.3a, decision N26): calendar files whose
 * events show read-only beside tasks in the Calendar and on Home. Add a
 * calendar file… reads an `.ics` in main and previews what it holds; then
 * the person names it and picks a colour. Each calendar can be reloaded
 * from the same file, hidden, renamed, or removed with undo. Ostler reads the
 * file only then, and never copies it.
 *
 * Subscribe to a calendar link… (N3.3b, decision N27) adds a private
 * calendar address that main fetches on its schedule. A saved link shows
 * only shortened (`linkShown`), with Refresh, Replace link, when it last
 * updated and, after a failed try, why.
 */
export function CalendarsGroup() {
  const { markSaved, setError } = useSettings()
  const { calendars, refresh } = useCalendars()
  const { toast, toastUndo } = useToast()
  const [file, setFile] = useState<ChosenCalendarFile | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [linkDialog, setLinkDialog] = useState<{ replacing?: OutsideCalendar } | null>(null)
  const [fromAccount, setFromAccount] = useState(false)
  const calendarAccounts = useAccountsWith('calendar.read')
  const writeAccounts = useAccountsWith('calendar.write')

  const changed = async <T,>(result: { ok: true; value: T } | { ok: false; error: string }) => {
    if (!result.ok) {
      setError(result.error)
      return null
    }
    setError(null)
    await refresh()
    markSaved()
    return result.value
  }

  const chooseFile = async () => {
    const chosen = await window.ostlerAPI.chooseCalendarFile()
    if (!chosen.ok) {
      setError(chosen.error)
      return
    }
    setError(null)
    if (chosen.value) setFile(chosen.value)
  }

  const reload = async (calendar: OutsideCalendar) => {
    setBusy(calendar.id)
    await changed(
      await (calendar.kind !== 'file'
        ? window.ostlerAPI.refreshCalendarLink(calendar.id)
        : window.ostlerAPI.reloadOutsideCalendar(calendar.id))
    )
    setBusy(null)
  }

  const remove = async (calendar: OutsideCalendar) => {
    const removed = await changed(await window.ostlerAPI.removeOutsideCalendar(calendar.id))
    if (!removed) return
    toastUndo(t('settings:calendars.removed', { name: calendar.name }), async () => {
      await changed(await window.ostlerAPI.restoreOutsideCalendar(calendar.id))
    })
  }

  return (
    <SettingsGroup
      id="calendars"
      description={t('settings:calendars.description')}
      fold={{
        summary:
          calendars.length === 0
            ? t('settings:calendars.summaryNone')
            : t('settings:calendars.summary', { count: calendars.length })
      }}
      actions={
        <>
          <Button size="sm" onClick={() => void chooseFile()}>
            {t('settings:calendars.add')}
          </Button>
          <Button size="sm" onClick={() => setLinkDialog({})}>
            {t('settings:calendars.subscribeLink')}
          </Button>
          {calendarAccounts.length > 0 && (
            <Button size="sm" onClick={() => setFromAccount(true)}>
              {t('settings:calendars.fromAccount')}
            </Button>
          )}
        </>
      }
    >
      {calendars.length === 0 ? (
        <p className="ostler-calendars__empty">{t('settings:calendars.none')}</p>
      ) : (
        <ul className="ostler-settings-people" aria-label={t('settings:calendars.title')}>
          {calendars.map((calendar) =>
            renaming === calendar.id ? (
              <li key={calendar.id} className="ostler-settings-person is-editing">
                <RenameForm
                  calendar={calendar}
                  onCancel={() => setRenaming(null)}
                  onSave={async (name) => {
                    if (
                      await changed(
                        await window.ostlerAPI.updateOutsideCalendar(calendar.id, { name })
                      )
                    )
                      setRenaming(null)
                  }}
                />
              </li>
            ) : (
              <li key={calendar.id} className="ostler-settings-person">
                <span
                  className="ostler-calendars__mark"
                  style={{ backgroundColor: calendar.color }}
                  aria-hidden="true"
                />
                <span className="ostler-settings-person-name">
                  {calendar.name}
                  {calendar.hidden && <Badge>{t('settings:calendars.hiddenBadge')}</Badge>}
                  <span className="ostler-settings-person-capacity">
                    {calendarCounts(calendar)}
                    {' · '}
                    {calendar.kind !== 'file'
                      ? linkUpdatedText(calendar)
                      : t('settings:calendars.loaded', {
                          when: formatDateTime(calendar.loadedAt)
                        })}
                  </span>
                  {calendar.kind !== 'file' && calendar.linkShown && (
                    <span className="ostler-calendars__path">{calendar.linkShown}</span>
                  )}
                  {calendar.kind !== 'file' && calendar.failure && (
                    <span className="ostler-calendars__failure">
                      {t('settings:calendars.failedLine', {
                        when: formatRelativeTime(calendar.failedAt ?? Date.now()),
                        reason: t(`errors:calendarLinks.failure.${calendar.failure}`)
                      })}
                    </span>
                  )}
                  {calendar.path && (
                    <span className="ostler-calendars__path" title={calendar.path}>
                      {calendar.path}
                    </span>
                  )}
                </span>
                <div className="ostler-settings-person-actions">
                  {calendar.kind !== 'file' && (
                    <Button
                      size="sm"
                      loading={busy === calendar.id}
                      aria-label={t('settings:calendars.refreshLabel', { name: calendar.name })}
                      onClick={() => void reload(calendar)}
                    >
                      {t('settings:calendars.refresh')}
                    </Button>
                  )}
                  {calendar.kind === 'link' && (
                    <>
                      <Button
                        size="sm"
                        aria-label={t('settings:calendars.replaceLabel', { name: calendar.name })}
                        onClick={() => setLinkDialog({ replacing: calendar })}
                      >
                        {t('settings:calendars.replaceButton')}
                      </Button>
                    </>
                  )}
                  {calendar.kind === 'file' && calendar.path && (
                    <Button
                      size="sm"
                      loading={busy === calendar.id}
                      aria-label={t('settings:calendars.reloadLabel', { name: calendar.name })}
                      onClick={() => void reload(calendar)}
                    >
                      {t('settings:calendars.reload')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    aria-label={t(
                      calendar.hidden
                        ? 'settings:calendars.showLabel'
                        : 'settings:calendars.hideLabel',
                      { name: calendar.name }
                    )}
                    onClick={async () =>
                      void changed(
                        await window.ostlerAPI.updateOutsideCalendar(calendar.id, {
                          hidden: !calendar.hidden
                        })
                      )
                    }
                  >
                    {calendar.hidden ? t('settings:calendars.show') : t('settings:calendars.hide')}
                  </Button>
                  <Button
                    size="sm"
                    aria-label={t('settings:calendars.renameLabel', { name: calendar.name })}
                    onClick={() => setRenaming(calendar.id)}
                  >
                    {t('settings:calendars.rename')}
                  </Button>
                  <Button
                    size="sm"
                    aria-label={t('settings:calendars.removeLabel', { name: calendar.name })}
                    onClick={() => void remove(calendar)}
                  >
                    {t('settings:calendars.remove')}
                  </Button>
                </div>
              </li>
            )
          )}
        </ul>
      )}
      {writeAccounts.length > 0 && (
        <CopyTargetRow kind={TIME_BLOCKS_INTO_CALENDAR} accounts={writeAccounts} />
      )}
      {linkDialog && (
        <CalendarLinkDialog
          replacing={linkDialog.replacing}
          used={new Set(calendars.map((calendar) => calendar.color))}
          onClose={() => setLinkDialog(null)}
          onDone={async (calendar) => {
            const replacing = linkDialog.replacing
            setLinkDialog(null)
            await refresh()
            markSaved()
            if (replacing) {
              toast({ title: t('settings:calendars.linkReplaced', { name: calendar.name }) })
              return
            }
            toastUndo(
              t('settings:calendars.subscribed', {
                name: calendar.name,
                counts: calendarCounts(calendar)
              }),
              async () => {
                await changed(await window.ostlerAPI.removeOutsideCalendar(calendar.id))
              }
            )
          }}
        />
      )}
      {fromAccount && (
        <AccountCalendarDialog
          accounts={calendarAccounts}
          onClose={() => setFromAccount(false)}
          onAdded={async (calendar) => {
            setFromAccount(false)
            await refresh()
            markSaved()
            toastUndo(
              t('settings:calendars.addedFromAccount', {
                name: calendar.name,
                counts: calendarCounts(calendar)
              }),
              async () => {
                await changed(await window.ostlerAPI.removeOutsideCalendar(calendar.id))
              }
            )
          }}
        />
      )}
      {file && (
        <AddDialog
          file={file}
          used={new Set(calendars.map((calendar) => calendar.color))}
          onClose={() => setFile(null)}
          onAdded={async (calendar) => {
            setFile(null)
            await refresh()
            markSaved()
            toastUndo(t('settings:calendars.added', { name: calendar.name }), async () => {
              await changed(await window.ostlerAPI.removeOutsideCalendar(calendar.id))
            })
          }}
        />
      )}
    </SettingsGroup>
  )
}

function RenameForm({
  calendar,
  onCancel,
  onSave
}: {
  calendar: OutsideCalendar
  onCancel: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(calendar.name)
  return (
    <form
      className="ostler-calendars__rename"
      aria-label={t('settings:calendars.renameLabel', { name: calendar.name })}
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) void onSave(name.trim())
      }}
    >
      <TextField
        label={t('settings:calendars.name')}
        maxLength={MAX_CALENDAR_NAME}
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <div className="ostler-settings-person-actions">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('settings:calendars.cancel')}
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
          {t('settings:calendars.save')}
        </Button>
      </div>
    </form>
  )
}

/** The add dialog: what the file holds, then a name and a colour. */
function AddDialog({
  file,
  used,
  onClose,
  onAdded
}: {
  file: ChosenCalendarFile
  used: ReadonlySet<string>
  onClose: () => void
  onAdded: (calendar: OutsideCalendar) => Promise<void>
}) {
  const [name, setName] = useState(file.fileName.replace(/\.ics$/i, '').slice(0, MAX_CALENDAR_NAME))
  const [color, setColor] = useState(
    () => PROJECT_COLORS.find((candidate) => !used.has(candidate)) ?? PROJECT_COLORS[0]
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const add = async () => {
    setBusy(true)
    const result = await window.ostlerAPI.addCalendarFile({
      path: file.path,
      name: name.trim(),
      color
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onAdded(result.value)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      title={t('settings:calendars.addTitle')}
      description={file.fileName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('settings:calendars.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void add()}
            loading={busy}
            disabled={busy || !name.trim() || file.readCount === 0}
          >
            {t('settings:calendars.addButton')}
          </Button>
        </>
      }
    >
      <div className="ostler-calendars__add">
        <p>{file.readCount > 0 ? calendarCounts(file) : t('settings:calendars.previewNone')}</p>
        {file.shownOnceCount > 0 && (
          <p className="ostler-calendars__hint">{t('settings:calendars.shownOnceHint')}</p>
        )}
        <TextField
          label={t('settings:calendars.name')}
          maxLength={MAX_CALENDAR_NAME}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <ProjectColorPicker
          colors={[...PROJECT_COLORS]}
          value={color}
          onChange={setColor}
          name="calendar-colour"
        />
        <p className="ostler-calendars__hint">{t('settings:calendars.privacy')}</p>
        {error && (
          <p className="ostler-calendars__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
