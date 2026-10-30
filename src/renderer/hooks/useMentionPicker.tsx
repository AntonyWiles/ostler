import type { RefObject } from 'react'
import type { Person } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { mentionLink } from '@shared/mentions'
import { t } from '@shared/i18n'
import { usePeople } from '../context/PeopleContext'
import { Avatar } from '../ui/Avatar'
import { useTextTriggerPicker, type TextTriggerPicker } from './useTextTriggerPicker'

const LIMIT = 8

/** Where an `@` was typed (at the start or after a space) and what follows it up to the caret, or null. */
export function findMentionTrigger(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const start = before.lastIndexOf('@')
  if (start < 0) return null
  if (start > 0 && !/\s/.test(before[start - 1])) return null
  const query = before.slice(start + 1)
  // A trigger ends at a line break or a bracket, and is short.
  if (/[\n[\]()]/.test(query) || query.length > 40) return null
  return { start, query }
}

/** The people whose names contain `query`, names that start with it first; at most eight. */
export function matchPeople(people: readonly Person[], query: string): Person[] {
  const needle = query.trim().toLowerCase()
  const starts: Person[] = []
  const contains: Person[] = []
  for (const person of people) {
    const name = person.name.toLowerCase()
    if (needle === '' || name.startsWith(needle)) starts.push(person)
    else if (name.includes(needle)) contains.push(person)
  }
  return [...starts, ...contains].slice(0, LIMIT)
}

export type MentionPicker = TextTriggerPicker

/**
 * Typing `@` in a comment (prompt 14): a picker of the project's people (the
 * ones the assignee picker offers), filtered as the person types. Enter or a
 * click inserts `[@Name](<scheme>://person/<id>)`; Esc leaves the typed text.
 * Mentioning someone grants nothing.
 */
export function useMentionPicker({
  projectId,
  value,
  onChange,
  textRef
}: {
  /** The project whose people are offered; null turns the picker off. */
  projectId: string | null
  value: string
  onChange: (next: string) => void
  textRef: RefObject<HTMLTextAreaElement | null>
}): MentionPicker {
  const people = usePeople()
  return useTextTriggerPicker<Person>({
    value,
    onChange,
    textRef,
    enabled: projectId !== null,
    findTrigger: findMentionTrigger,
    options: (query) => (projectId === null ? [] : matchPeople(people.offered(projectId), query)),
    insertText: (person) => `${mentionLink(person, BRAND.urlScheme)} `,
    optionKey: (person) => person.id,
    renderOption: (person) => (
      <>
        <Avatar name={person.name} color={person.color} initials={person.initials} size="sm" />
        <span className="ui-item-link-picker__title">{person.name}</span>
      </>
    ),
    label: () => t('common:mentions.picker')
  })
}
