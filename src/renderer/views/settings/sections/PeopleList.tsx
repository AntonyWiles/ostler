import { useState } from 'react'
import {
  DEFAULT_WORKING_DAYS,
  MAX_WEEKLY_CAPACITY_HOURS,
  type Person,
  type UpdatePersonInput
} from '@shared/ostler-api'
import { formatIsoDate, shiftIsoDate } from '@shared/dates'
import { formatList, formatNumber } from '@shared/format'
import { PROJECT_COLORS } from '@shared/project-colors'
import { usePeople } from '../../../context/PeopleContext'
import { ProjectColorPicker } from '../../../components/ProjectColorPicker'
import { PersonAvatar } from '../../planning/AssigneeField'
import { Badge, Button, Checkbox, NumberField, TextField, useToast } from '../../../ui'
import { DeletePersonDialog } from './DeletePersonDialog'
import '../../SettingsView.css'
import { t } from '@shared/i18n'

/**
 * One place's people (D5, migration 78): the address book (`projectId` null,
 * Settings › People) or a project's own (its settings' People). The same rows
 * either way: add, edit, make Me (address book only), archive with undo, and
 * delete, which asks first and says what happens to their work.
 */
export function PeopleList({
  projectId,
  label,
  onSaved,
  onError
}: {
  projectId: string | null
  /** The list's accessible name. */
  label: string
  onSaved: () => void
  onError: (error: string | null) => void
}) {
  const people = usePeople()
  const { toast, toastUndo } = useToast()
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Person | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const here = people.all.filter((person) => person.projectId === projectId)
  const active = here.filter((person) => person.archivedAt === null)
  const listed = showArchived ? here : active
  const archivedCount = here.length - active.length

  const changed = async (result: { ok: true } | { ok: false; error: string }) => {
    if (!result.ok) {
      onError(result.error)
      return false
    }
    onError(null)
    await people.refresh()
    onSaved()
    return true
  }

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    if (await changed(await window.ostlerAPI.createPerson({ name, projectId }))) setNewName('')
  }

  const archive = async (person: Person) => {
    if (!(await changed(await window.ostlerAPI.archivePerson(person.id)))) return
    toastUndo(t('settings:peopleSection.archived2', { personName: person.name }), async () => {
      await changed(await window.ostlerAPI.unarchivePerson(person.id))
    })
  }

  return (
    <>
      {listed.length > 0 && (
        <ul className="ostler-settings-people" aria-label={label}>
          {listed.map((person) =>
            editing === person.id ? (
              <li key={person.id} className="ostler-settings-person is-editing">
                <PersonEditor
                  person={person}
                  onCancel={() => setEditing(null)}
                  onSave={async (updates) => {
                    if (await changed(await window.ostlerAPI.updatePerson(person.id, updates)))
                      setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={person.id} className="ostler-settings-person">
                <PersonAvatar person={person} size="md" />
                <span className="ostler-settings-person-name">
                  {person.name}
                  {person.isMe && <Badge tone="info">{t('settings:peopleSection.you')}</Badge>}
                  {person.archivedAt !== null && (
                    <Badge>{t('settings:peopleSection.archived')}</Badge>
                  )}
                  <span className="ostler-settings-person-capacity">{capacityText(person)}</span>
                </span>
                <div className="ostler-settings-person-actions">
                  {!person.isMe && person.archivedAt === null && projectId === null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('settings:peopleSection.me2', { personName: person.name })}
                      onClick={() => void window.ostlerAPI.setMe(person.id).then(changed)}
                    >
                      {t('settings:peopleSection.me')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    aria-label={t('settings:peopleSection.edit2', { personName: person.name })}
                    onClick={() => setEditing(person.id)}
                  >
                    {t('settings:peopleSection.edit')}
                  </Button>
                  {person.archivedAt === null ? (
                    <Button
                      size="sm"
                      disabled={person.isMe}
                      title={
                        person.isMe ? t('settings:peopleSection.chooseSomeoneElseFirst') : undefined
                      }
                      aria-label={t('settings:peopleSection.archive2', { personName: person.name })}
                      onClick={() => void archive(person)}
                    >
                      {t('settings:peopleSection.archive')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      aria-label={t('settings:peopleSection.restore2', { personName: person.name })}
                      onClick={() => void window.ostlerAPI.unarchivePerson(person.id).then(changed)}
                    >
                      {t('settings:peopleSection.restore')}
                    </Button>
                  )}
                  {!person.isMe && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('settings:peopleSection.delete2', { personName: person.name })}
                      onClick={() => setDeleting(person)}
                    >
                      {t('settings:peopleSection.delete')}
                    </Button>
                  )}
                </div>
              </li>
            )
          )}
        </ul>
      )}
      {archivedCount > 0 && (
        <Checkbox
          label={t('settings:peopleSection.showArchivedPeople', { archivedCount })}
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
      )}
      <form
        className="ostler-settings-person-add"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <TextField
          label={t('settings:peopleSection.addPerson')}
          placeholder={t('settings:peopleSection.name')}
          maxLength={80}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!newName.trim()}>
          {t('settings:peopleSection.addPerson2')}
        </Button>
      </form>
      {deleting && (
        <DeletePersonDialog
          person={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            const name = deleting.name
            setDeleting(null)
            void people.refresh().then(() => {
              onSaved()
              toast({ title: t('settings:peopleSection.deleted', { personName: name }) })
            })
          }}
        />
      )}
    </>
  )
}

function PersonEditor({
  person,
  onCancel,
  onSave
}: {
  person: Person
  onCancel: () => void
  onSave: (updates: UpdatePersonInput) => Promise<void>
}) {
  const [name, setName] = useState(person.name)
  const [initials, setInitials] = useState(person.initials)
  const [color, setColor] = useState(person.color)
  const [capacity, setCapacity] = useState<number | null>(person.weeklyCapacityHours)
  const [days, setDays] = useState<number[]>(person.workingDays)
  const toggleDay = (day: number, on: boolean) =>
    setDays((current) =>
      on ? [...current, day].sort((a, b) => a - b) : current.filter((entry) => entry !== day)
    )
  return (
    <form
      className="ostler-settings-person-editor"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim() && days.length > 0)
          void onSave({
            name: name.trim(),
            initials: initials.trim(),
            color,
            weeklyCapacityHours: capacity,
            workingDays: days
          })
      }}
    >
      <div className="ostler-settings-person-fields">
        <TextField
          label={t('settings:peopleSection.name')}
          value={name}
          maxLength={80}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={t('settings:peopleSection.initials')}
          value={initials}
          maxLength={3}
          hint={t('settings:peopleSection.leaveEmptyUseNames')}
          onChange={(event) => setInitials(event.target.value)}
        />
      </div>
      <ProjectColorPicker
        colors={[...PROJECT_COLORS]}
        value={color}
        onChange={setColor}
        name={`person-colour-${person.id}`}
      />
      <div className="ostler-settings-person-capacity-fields">
        <NumberField
          label={t('settings:peopleSection.weeklyCapacity')}
          hint={t('settings:peopleSection.weeklyCapacityHint')}
          unit={t('settings:peopleSection.hoursUnit')}
          min={0}
          max={MAX_WEEKLY_CAPACITY_HOURS}
          step={0.5}
          value={capacity}
          onChange={setCapacity}
        />
        <fieldset className="ostler-settings-person-days">
          <legend>{t('settings:peopleSection.workingDays')}</legend>
          {ISO_WEEKDAYS.map((day) => (
            <Checkbox
              key={day}
              label={weekdayName(day, 'short')}
              aria-label={weekdayName(day, 'long')}
              checked={days.includes(day)}
              onChange={(event) => toggleDay(day, event.target.checked)}
            />
          ))}
          {days.length === 0 && (
            <p className="ostler-settings-person-days-error" role="alert">
              {t('settings:peopleSection.chooseWorkingDay')}
            </p>
          )}
        </fieldset>
      </div>
      <div className="ostler-settings-person-actions">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('settings:peopleSection.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={!name.trim() || days.length === 0}
        >
          {t('settings:peopleSection.save')}
        </Button>
      </div>
    </form>
  )
}

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
/** A Monday, to name weekdays in the active locale. */
const A_MONDAY = '2024-01-01'

function weekdayName(day: number, width: 'short' | 'long'): string {
  return formatIsoDate(shiftIsoDate(A_MONDAY, day - 1), { weekday: width })
}

/** "40 h a week · Mon, Tue, Wed and Thu", or just the days when they differ from the default. */
function capacityText(person: Person): string {
  const parts: string[] = []
  if (person.weeklyCapacityHours !== null)
    parts.push(
      t('settings:peopleSection.hoursAWeek', {
        hours: formatNumber(person.weeklyCapacityHours, { maximumFractionDigits: 2 })
      })
    )
  const standard =
    person.workingDays.length === DEFAULT_WORKING_DAYS.length &&
    person.workingDays.every((day, index) => day === DEFAULT_WORKING_DAYS[index])
  if (!standard) parts.push(formatList(person.workingDays.map((day) => weekdayName(day, 'short'))))
  return parts.join(' · ')
}
