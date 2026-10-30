import { useState } from 'react'
import type { Person } from '@shared/ostler-api'
import { Avatar, Button, Combobox, type ComboboxOption } from '../../ui'
import { usePeople } from '../../context/PeopleContext'
import { t } from '@shared/i18n'

const UNASSIGNED = ''

/** A person's avatar: their colour and initials. */
export function PersonAvatar({ person, size = 'sm' }: { person: Person; size?: 'sm' | 'md' }) {
  return <Avatar name={person.name} initials={person.initials} color={person.color} size={size} />
}

/**
 * Who is doing a task (P5.1): a Combobox of people with their avatars, with
 * "Assign to me" (or, once it is, "Unassign me") one click away and "Add person" for a name that is not on
 * the list. It offers the address book and the task's project's own people
 * (`offered`). Archived people are not offered, but a task already assigned
 * to one keeps showing them.
 */
export function AssigneeField({
  projectId,
  value,
  onChange,
  label = t('tasks:assigneeField.assignee'),
  className
}: {
  /** The task's project: its own people are offered with the address book. */
  projectId: string | null
  value: string | null
  onChange: (personId: string | null) => void
  label?: string
  className?: string
}) {
  const people = usePeople()
  const [error, setError] = useState<string | null>(null)
  const current = value ? people.byId.get(value) : undefined
  const offered = current?.archivedAt
    ? [...people.offered(projectId), current]
    : people.offered(projectId)

  const options: ComboboxOption[] = [
    { value: UNASSIGNED, label: t('tasks:assigneeField.unassigned') },
    ...offered.map((person) => ({
      value: person.id,
      label: person.isMe ? t('tasks:assigneeField.you', { personName: person.name }) : person.name,
      description: person.archivedAt ? t('tasks:assigneeField.archived') : undefined,
      prefix: <PersonAvatar person={person} />
    }))
  ]

  const addPerson = async (name: string) => {
    setError(null)
    try {
      const person = await people.createPerson({ name })
      onChange(person.id)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t('tasks:assigneeField.couldNotAddPerson')
      )
    }
  }

  return (
    <div className={['assignee-field', className].filter(Boolean).join(' ')}>
      <Combobox
        label={label}
        options={options}
        value={value ?? UNASSIGNED}
        onChange={(next) => {
          setError(null)
          onChange(next ? next : null)
        }}
        onCreate={(name) => void addPerson(name)}
        createLabel={(name) => t('tasks:assigneeField.addPerson', { name })}
        placeholder={t('tasks:assigneeField.unassigned')}
        emptyText={t('tasks:assigneeField.typeNameAddPerson')}
        error={error ?? undefined}
      />
      {/* Always there, so the field never changes width (MOP-13): once the
          task is yours it offers to take you off it instead. */}
      {people.me && (
        <Button
          size="sm"
          variant="ghost"
          className="assignee-field__me"
          onClick={() => onChange(value === people.me!.id ? null : people.me!.id)}
        >
          {value === people.me.id
            ? t('tasks:assigneeField.unassignMe')
            : t('tasks:assigneeField.assignMe')}
        </Button>
      )}
    </div>
  )
}
