import { useState } from 'react'
import { MAX_CALENDAR_NAME, type OutsideCalendar } from '@shared/ostler-api'
import { PROJECT_COLORS } from '@shared/project-colors'
import { t } from '@shared/i18n'
import { Button, Dialog, TextField } from '../../../ui'
import { ProjectColorPicker } from '../../../components/ProjectColorPicker'

/**
 * Subscribe to a calendar link… and Replace link (N3.3b): the person pastes
 * a calendar's private address. Main fetches it before anything is saved;
 * the renderer never fetches, and never sees the link again once saved.
 */
export function CalendarLinkDialog({
  replacing,
  used,
  onClose,
  onDone
}: {
  /** The link calendar whose address is replaced; absent to subscribe to a new one. */
  replacing?: OutsideCalendar
  used: ReadonlySet<string>
  onClose: () => void
  onDone: (calendar: OutsideCalendar) => Promise<void>
}) {
  const [link, setLink] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState(
    () => PROJECT_COLORS.find((candidate) => !used.has(candidate)) ?? PROJECT_COLORS[0]
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = link.trim() !== '' && (replacing !== undefined || name.trim() !== '')

  const save = async () => {
    setBusy(true)
    setError(null)
    const result = replacing
      ? await window.ostlerAPI.replaceCalendarLink(replacing.id, link.trim())
      : await window.ostlerAPI.addCalendarLink({ link: link.trim(), name: name.trim(), color })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onDone(result.value)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      title={
        replacing
          ? t('settings:calendars.replaceTitle', { name: replacing.name })
          : t('settings:calendars.linkTitle')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('settings:calendars.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            loading={busy}
            disabled={busy || !ready}
          >
            {replacing ? t('settings:calendars.replaceButton') : t('settings:calendars.subscribe')}
          </Button>
        </>
      }
    >
      <form
        className="ostler-calendars__add"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready && !busy) void save()
        }}
      >
        <p className="ostler-calendars__hint">{t('settings:calendars.linkHint')}</p>
        <TextField
          label={t('settings:calendars.linkField')}
          value={link}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setLink(event.target.value)}
        />
        {!replacing && (
          <>
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
              name="calendar-link-colour"
            />
          </>
        )}
        <p className="ostler-calendars__hint">{t('settings:calendars.linkPrivacy')}</p>
        {error && (
          <p className="ostler-calendars__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
