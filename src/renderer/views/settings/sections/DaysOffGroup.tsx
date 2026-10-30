import { useEffect, useMemo, useState } from 'react'
import {
  MAX_DAY_OFF_NAME,
  type DayOff,
  type DaysOffFile,
  type DaysOffImportPreview,
  type Person
} from '@shared/ostler-api'
import { compareIsoDates, formatIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { usePeople } from '../../../context/PeopleContext'
import { useDaysOff } from '../../../context/DaysOffContext'
import { Badge, Button, DateField, Dialog, Select, TextField, useToast } from '../../../ui'
import { SettingsGroup, useSettings } from '../settings-form'
import './DaysOffGroup.css'

/** The Select value for "Everyone". */
const EVERYONE = ''
/** How many of a file's days the preview lists before "and N more". */
const PREVIEW_ROWS = 50

/** "25 December 2026", or "3 to 14 August 2026" for a run of days. */
export function dayOffDates(day: Pick<DayOff, 'firstDate' | 'lastDate'>): string {
  const long = { day: 'numeric', month: 'long', year: 'numeric' } as const
  if (day.firstDate === day.lastDate) return formatIsoDate(day.firstDate, long)
  return t('settings:daysOff.range', {
    first: formatIsoDate(day.firstDate, long),
    last: formatIsoDate(day.lastDate, long)
  })
}

/** A load of a file, named with whom it is for: "england.ics, for everyone". */
function fileLoadLabel(
  fileName: string,
  personId: string | null,
  byId: ReadonlyMap<string, Person>
): string {
  return personId === null
    ? t('settings:daysOff.fileForEveryone', { fileName })
    : t('settings:daysOff.fileForPerson', { fileName, person: byId.get(personId)?.name ?? '' })
}

/**
 * Settings › People › Days off (N3.2, decision N25): days nobody works (bank
 * holidays, for Everyone) and each person's leave. Add a day or a range by
 * hand, edit it, or remove it with an undo toast. Import a holiday
 * calendar… reads an `.ics` file in main and previews its all-day events
 * before adding them; loading the same file again for the same person (or
 * for everyone again) replaces its days, while a load for someone else is
 * kept beside it, and Remove all from this file takes one load away (with
 * undo). What a day off does
 * elsewhere is `@shared/planning/working-days`'s.
 */
export function DaysOffGroup() {
  const { markSaved, setError } = useSettings()
  const people = usePeople()
  const { daysOff, refresh } = useDaysOff()
  const { toastUndo } = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [file, setFile] = useState<DaysOffFile | null>(null)

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

  const everyone = daysOff.filter((day) => day.personId === null)
  const leave = useMemo(() => {
    const byPerson = new Map<string, DayOff[]>()
    for (const day of daysOff) {
      if (!day.personId) continue
      byPerson.set(day.personId, [...(byPerson.get(day.personId) ?? []), day])
    }
    return [...byPerson.entries()]
      .map(([personId, days]) => ({ person: people.byId.get(personId) ?? null, personId, days }))
      .sort((a, b) => (a.person?.name ?? '').localeCompare(b.person?.name ?? ''))
  }, [daysOff, people.byId])
  // Each load of a file: the same name for two people is two loads, each removed on its own.
  const files = useMemo(() => {
    const loads = new Map<string, { fileName: string; personId: string | null; count: number }>()
    for (const day of daysOff) {
      if (day.sourceFile === null) continue
      const key = JSON.stringify([day.sourceFile, day.personId])
      const load = loads.get(key) ?? { fileName: day.sourceFile, personId: day.personId, count: 0 }
      load.count++
      loads.set(key, load)
    }
    return [...loads.values()]
      .map((load) => ({ ...load, label: fileLoadLabel(load.fileName, load.personId, people.byId) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [daysOff, people.byId])

  const remove = async (day: DayOff) => {
    const removed = await changed(await window.ostlerAPI.removeDayOff(day.id))
    if (!removed) return
    toastUndo(t('settings:daysOff.removed', { name: day.name }), async () => {
      await changed(await window.ostlerAPI.restoreDaysOff([removed]))
    })
  }

  const removeFile = async (load: { fileName: string; personId: string | null; label: string }) => {
    const removed = await changed(
      await window.ostlerAPI.removeDaysOffFile(load.fileName, load.personId)
    )
    if (!removed) return
    toastUndo(
      t('settings:daysOff.removedFile', { count: removed.length, fileName: load.label }),
      async () => {
        await changed(await window.ostlerAPI.restoreDaysOff(removed))
      }
    )
  }

  const chooseFile = async () => {
    const chosen = await window.ostlerAPI.chooseDaysOffFile()
    if (!chosen.ok) {
      setError(chosen.error)
      return
    }
    setError(null)
    if (chosen.value) setFile(chosen.value)
  }

  const renderDay = (day: DayOff) =>
    editing === day.id ? (
      <li key={day.id} className="ostler-settings-person is-editing">
        <DayOffForm
          people={people.offered(null)}
          initial={day}
          submitLabel={t('settings:daysOff.save')}
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            if (await changed(await window.ostlerAPI.updateDayOff(day.id, input))) setEditing(null)
          }}
        />
      </li>
    ) : (
      <li key={day.id} className="ostler-settings-person">
        <span className="ostler-settings-person-name">
          {day.name}
          <span className="ostler-settings-person-capacity">{dayOffDates(day)}</span>
          {day.sourceFile && <Badge>{day.sourceFile}</Badge>}
        </span>
        <div className="ostler-settings-person-actions">
          <Button
            size="sm"
            aria-label={t('settings:daysOff.editLabel', {
              name: day.name,
              dates: dayOffDates(day)
            })}
            onClick={() => setEditing(day.id)}
          >
            {t('settings:daysOff.edit')}
          </Button>
          <Button
            size="sm"
            aria-label={t('settings:daysOff.removeLabel', {
              name: day.name,
              dates: dayOffDates(day)
            })}
            onClick={() => void remove(day)}
          >
            {t('settings:daysOff.remove')}
          </Button>
        </div>
      </li>
    )

  return (
    <SettingsGroup
      id="days-off"
      description={t('settings:daysOff.description')}
      actions={
        <Button size="sm" onClick={() => void chooseFile()}>
          {t('settings:daysOff.import')}
        </Button>
      }
    >
      <section className="ostler-days-off__list" aria-labelledby="days-off-everyone">
        <h4 id="days-off-everyone" className="ostler-days-off__heading">
          {t('settings:daysOff.everyone')}
        </h4>
        {everyone.length > 0 ? (
          <ul className="ostler-settings-people" aria-labelledby="days-off-everyone">
            {everyone.map(renderDay)}
          </ul>
        ) : (
          <p className="ostler-days-off__empty">{t('settings:daysOff.noneForEveryone')}</p>
        )}
      </section>
      {leave.map(({ person, personId, days }) => {
        const headingId = `days-off-person-${personId}`
        return (
          <section key={personId} className="ostler-days-off__list" aria-labelledby={headingId}>
            <h4 id={headingId} className="ostler-days-off__heading">
              {t('settings:daysOff.leaveFor', { person: person?.name ?? '' })}
              {person?.archivedAt != null && <Badge>{t('settings:peopleSection.archived')}</Badge>}
            </h4>
            <ul className="ostler-settings-people" aria-labelledby={headingId}>
              {days.map(renderDay)}
            </ul>
          </section>
        )
      })}
      {files.length > 0 && (
        <section className="ostler-days-off__list" aria-labelledby="days-off-files">
          <h4 id="days-off-files" className="ostler-days-off__heading">
            {t('settings:daysOff.files')}
          </h4>
          <ul className="ostler-settings-people" aria-labelledby="days-off-files">
            {files.map((load) => (
              <li key={`${load.fileName} ${load.personId ?? ''}`} className="ostler-settings-person">
                <span className="ostler-settings-person-name">
                  {load.label}
                  <span className="ostler-settings-person-capacity">
                    {t('settings:daysOff.fileDays', { count: load.count })}
                  </span>
                </span>
                <Button
                  size="sm"
                  aria-label={t('settings:daysOff.removeFileLabel', { fileName: load.label })}
                  onClick={() => void removeFile(load)}
                >
                  {t('settings:daysOff.removeFile')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <DayOffForm
        people={people.offered(null)}
        legend={t('settings:daysOff.addHeading')}
        submitLabel={t('settings:daysOff.add')}
        resetOnSubmit
        onSubmit={async (input) =>
          Boolean(await changed(await window.ostlerAPI.createDayOff(input)))
        }
      />
      {file && (
        <ImportDialog
          file={file}
          people={people.offered(null)}
          onClose={() => setFile(null)}
          onImported={async (fileName, personId, added, replaced) => {
            setFile(null)
            await refresh()
            markSaved()
            const label = fileLoadLabel(fileName, personId, people.byId)
            toastUndo(
              t('settings:daysOff.imported', { count: added, fileName: label }),
              async () => {
                // Undo takes away this load only; a load of the same file for someone else stays.
                await changed(await window.ostlerAPI.removeDaysOffFile(fileName, personId))
                if (replaced.length > 0)
                  await changed(await window.ostlerAPI.restoreDaysOff(replaced))
              }
            )
          }}
        />
      )}
    </SettingsGroup>
  )
}

interface DayOffInput {
  personId: string | null
  firstDate: string
  lastDate: string
  name: string
}

function personOptions(people: readonly Person[]) {
  return [
    { value: EVERYONE, label: t('settings:daysOff.everyone') },
    ...people.map((person) => ({ value: person.id, label: person.name }))
  ]
}

/** Who, a name, and the first and last day: adding and editing a day off. */
function DayOffForm({
  people,
  initial,
  legend,
  submitLabel,
  resetOnSubmit,
  onCancel,
  onSubmit
}: {
  people: readonly Person[]
  initial?: DayOff
  legend?: string
  submitLabel: string
  resetOnSubmit?: boolean
  onCancel?: () => void
  /** Resolves true when it was saved. */
  onSubmit: (input: DayOffInput) => Promise<boolean | void>
}) {
  const [personId, setPersonId] = useState(initial?.personId ?? EVERYONE)
  const [name, setName] = useState(initial?.name ?? '')
  const [firstDate, setFirstDate] = useState(initial?.firstDate ?? '')
  const [lastDate, setLastDate] = useState(
    initial && initial.lastDate !== initial.firstDate ? initial.lastDate : ''
  )
  const backwards = !!firstDate && !!lastDate && compareIsoDates(lastDate, firstDate) < 0
  const ready = !!name.trim() && !!firstDate && !backwards
  const options = personOptions(people)
  // An archived person's leave keeps its person while edited.
  if (initial?.personId && !options.some((option) => option.value === initial.personId))
    options.push({ value: initial.personId, label: t('settings:peopleSection.archived') })

  return (
    <form
      className="ostler-days-off__form"
      aria-label={legend ?? submitLabel}
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        void onSubmit({
          personId: personId === EVERYONE ? null : personId,
          name: name.trim(),
          firstDate,
          lastDate: lastDate || firstDate
        }).then((saved) => {
          if (saved && resetOnSubmit) {
            setName('')
            setFirstDate('')
            setLastDate('')
          }
        })
      }}
    >
      {legend && <h4 className="ostler-days-off__heading">{legend}</h4>}
      <div className="ostler-days-off__fields">
        <Select
          label={t('settings:daysOff.who')}
          options={options}
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
        />
        <TextField
          label={t('settings:daysOff.name')}
          placeholder={t('settings:daysOff.namePlaceholder')}
          maxLength={MAX_DAY_OFF_NAME}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <DateField
          label={t('settings:daysOff.firstDay')}
          value={firstDate}
          onChange={setFirstDate}
          due={false}
        />
        <DateField
          label={t('settings:daysOff.lastDay')}
          hint={t('settings:daysOff.lastDayHint')}
          value={lastDate}
          onChange={setLastDate}
          min={firstDate || undefined}
          due={false}
          error={backwards ? t('settings:daysOff.lastBeforeFirst') : undefined}
        />
      </div>
      <div className="ostler-settings-person-actions">
        {onCancel && (
          <Button size="sm" variant="secondary" onClick={onCancel}>
            {t('settings:daysOff.cancel')}
          </Button>
        )}
        <Button size="sm" variant="primary" type="submit" disabled={!ready}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

/** The import preview: who the days are for, what will be added and what is skipped. */
function ImportDialog({
  file,
  people,
  onClose,
  onImported
}: {
  file: DaysOffFile
  people: readonly Person[]
  onClose: () => void
  onImported: (
    fileName: string,
    personId: string | null,
    added: number,
    replaced: DayOff[]
  ) => Promise<void>
}) {
  const [personId, setPersonId] = useState(EVERYONE)
  const [preview, setPreview] = useState<DaysOffImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = { ...file, personId: personId === EVERYONE ? null : personId }

  useEffect(() => {
    let live = true
    void window.ostlerAPI
      .previewDaysOffImport({ ...file, personId: personId === EVERYONE ? null : personId })
      .then((result) => {
        if (!live) return
        setPreview(result.ok ? result.value : null)
        setError(result.ok ? null : result.error)
      })
    return () => {
      live = false
    }
  }, [file, personId])

  const skippedReason = {
    timed: t('settings:daysOff.skippedTimed'),
    repeat: t('settings:daysOff.skippedRepeat'),
    'no-date': t('settings:daysOff.skippedNoDate')
  }

  const run = async () => {
    setBusy(true)
    const result = await window.ostlerAPI.importDaysOff(input)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onImported(
      result.value.fileName,
      result.value.personId,
      result.value.added.length,
      result.value.replaced
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      title={t('settings:daysOff.importTitle')}
      description={file.fileName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('settings:daysOff.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void run()}
            disabled={busy || !preview || preview.days.length === 0}
          >
            {t('settings:daysOff.importDays', { count: preview?.days.length ?? 0 })}
          </Button>
        </>
      }
    >
      <div className="ostler-days-off__preview">
        <Select
          label={t('settings:daysOff.importFor')}
          options={personOptions(people)}
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
        />
        {error && (
          <p className="ostler-days-off__error" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <>
            <p>
              {preview.days.length > 0
                ? t('settings:daysOff.previewCount', { count: preview.days.length })
                : t('settings:daysOff.previewNone')}
              {preview.replacedCount > 0 &&
                ` ${t('settings:daysOff.previewReplaces', { count: preview.replacedCount })}`}
            </p>
            {preview.days.length > 0 && (
              <ul
                className="ostler-days-off__preview-list"
                aria-label={t('settings:daysOff.toAdd')}
              >
                {preview.days.slice(0, PREVIEW_ROWS).map((day, index) => (
                  <li key={`${day.firstDate}:${index}`}>
                    <span className="ostler-days-off__preview-name">{day.name}</span>{' '}
                    <span className="ostler-settings-person-capacity">{dayOffDates(day)}</span>
                  </li>
                ))}
                {preview.days.length > PREVIEW_ROWS && (
                  <li>
                    {t('settings:daysOff.andMore', {
                      count: preview.days.length - PREVIEW_ROWS
                    })}
                  </li>
                )}
              </ul>
            )}
            {preview.skipped.length > 0 && (
              <>
                <p>{t('settings:daysOff.skippedCount', { count: preview.skipped.length })}</p>
                <ul
                  className="ostler-days-off__preview-list"
                  aria-label={t('settings:daysOff.skipped')}
                >
                  {preview.skipped.slice(0, PREVIEW_ROWS).map((skipped, index) => (
                    <li key={index}>
                      <span className="ostler-days-off__preview-name">{skipped.name}</span>{' '}
                      <span className="ostler-settings-person-capacity">
                        {skippedReason[skipped.reason]}
                      </span>
                    </li>
                  ))}
                  {preview.skipped.length > PREVIEW_ROWS && (
                    <li>
                      {t('settings:daysOff.andMore', {
                        count: preview.skipped.length - PREVIEW_ROWS
                      })}
                    </li>
                  )}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
