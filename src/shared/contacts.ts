import type { PlanningWorkItemStatus } from './ostler-api/planning-types'
import { t } from './i18n'

/**
 * Contacts (N6.5, N48): the people a project involves who do no work in it.
 * They are not People: nothing is assigned to them and they are not in
 * Workload. One contact list is shared by every project; a task names a
 * contact with a role. This file is the one description of their shape,
 * limits and the addresses Call, Email and Open website hand to Windows.
 */

export const TASK_CONTACT_ROLES = ['asked-for-it', 'supplier', 'other'] as const
export type TaskContactRole = (typeof TASK_CONTACT_ROLES)[number]

export function isTaskContactRole(value: unknown): value is TaskContactRole {
  return TASK_CONTACT_ROLES.includes(value as TaskContactRole)
}

/** A role's words: "Asked for it", "Supplier", "Other". */
export function contactRoleLabel(role: TaskContactRole): string {
  switch (role) {
    case 'asked-for-it':
      return t('tasks:contactRoles.askedForIt')
    case 'supplier':
      return t('tasks:contactRoles.supplier')
    case 'other':
      return t('tasks:contactRoles.other')
  }
}

export interface ContactPhone {
  /** "Mobile", "Work"; may be empty. */
  label: string
  /** As typed: "+44 (0)20 7946 0018". `telHref` makes the address. */
  number: string
}

export interface Contact {
  id: string
  name: string
  organisation: string
  role: string
  phones: ContactPhone[]
  emails: string[]
  website: string
  address: string
  notes: string
  createdAt: number
  updatedAt: number
}

/** What a new contact or an edit sends; a field left out keeps its value (or is empty). */
export interface ContactInput {
  name?: string
  organisation?: string
  role?: string
  phones?: ContactPhone[]
  emails?: string[]
  website?: string
  address?: string
  notes?: string
}

/** A task's link to a contact, as stored. */
export interface TaskContactLink {
  id: string
  projectId: string
  workItemId: string
  contactId: string
  role: TaskContactRole
  createdAt: number
}

/** A task's contact for the drawer: the link with the contact itself. */
export interface TaskContact extends TaskContactLink {
  contact: Contact
}

/** A task that names a contact, for the Contacts view: across projects. */
export interface ContactTask {
  linkId: string
  projectId: string
  workItemId: string
  title: string
  status: PlanningWorkItemStatus
  role: TaskContactRole
  /** Archived or in the recycle bin. */
  closed: boolean
}

/** A contact and the links it had, as deleting it returns them, so Undo can put both back. */
export interface DeletedContact {
  contact: Contact
  links: TaskContactLink[]
}

/** Which contacts each task names, by task id: what the Contact filter and the card mark read. */
export type TaskContactMarks = Record<string, { contactId: string; role: TaskContactRole }[]>

export const CONTACT_LIMITS = {
  name: 120,
  organisation: 120,
  role: 120,
  phones: 10,
  phoneLabel: 40,
  phoneNumber: 40,
  emails: 10,
  email: 254,
  website: 2000,
  address: 500,
  notes: 5000,
  /** Contacts a task can name, in all roles together. */
  perTask: 20,
  /** Contacts Ostler keeps in all. */
  total: 20000
} as const

/**
 * An email address Email can open: one address, no spaces, nothing a
 * `mailto:` link would read as a header, a subject or a second recipient.
 */
const EMAIL =
  /^[\p{L}\p{N}.!$'*+\-/=^_`{|}~]{1,64}@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}[\p{L}\p{N}])?)+$/u

export function isEmailAddress(value: string): boolean {
  return value.length <= CONTACT_LIMITS.email && EMAIL.test(value)
}

/** How two emails are compared when importing: trimmed, in lower case. */
export function emailKey(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * The `tel:` address for a stored number: its digits and a leading `+`
 * only, so nothing typed beside the number reaches Windows. Null when the
 * number has no digits.
 */
export function telHref(number: string): string | null {
  const digits = number.replace(/\D/g, '')
  if (digits.length === 0 || digits.length > 30) return null
  return `tel:${number.trim().startsWith('+') ? '+' : ''}${digits}`
}

/** The `mailto:` address for a stored email, or null when it is not one address. */
export function mailtoHref(email: string): string | null {
  const address = email.trim()
  return isEmailAddress(address) ? `mailto:${address}` : null
}

/**
 * The web address Open website opens: http or https only. A website typed
 * without one ("example.com") gets https. Null for anything else.
 */
export function websiteHref(website: string): string | null {
  const text = website.trim()
  if (!text || /\s/.test(text)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url.href
  } catch {
    return null
  }
}

/** Whether `url` is exactly an address Call or Email builds: `tel:` digits, or `mailto:` one address. */
export function isContactAddress(url: string): boolean {
  if (/^tel:\+?\d{1,30}$/.test(url)) return true
  return url.startsWith('mailto:') && isEmailAddress(url.slice('mailto:'.length))
}

/** The words a contact is found by in its list: name, organisation, role, emails and phones. */
export function contactMatches(contact: Contact, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = [
    contact.name,
    contact.organisation,
    contact.role,
    ...contact.emails,
    ...contact.phones.map((phone) => phone.number)
  ]
    .join('\n')
    .toLowerCase()
  const digits = haystack.replace(/[^\d\n]/g, '')
  return words.every(
    (word) =>
      haystack.includes(word) || (/^\+?\d+$/.test(word) && digits.includes(word.replace('+', '')))
  )
}

/** The line under a contact's name: "Role, Organisation". */
export function contactSubtitle(contact: Pick<Contact, 'organisation' | 'role'>): string {
  return [contact.role, contact.organisation].filter((part) => part.trim() !== '').join(', ')
}
