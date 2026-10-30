import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { PlanningWorkItem, PlanningWorkItemStatus } from '@shared/ostler-api'
import {
  CONTACT_LIMITS,
  contactMatches,
  emailKey,
  isEmailAddress,
  isTaskContactRole,
  websiteHref,
  type Contact,
  type ContactInput,
  type ContactPhone,
  type ContactTask,
  type DeletedContact,
  type TaskContact,
  type TaskContactLink,
  type TaskContactMarks,
  type TaskContactRole
} from '@shared/contacts'
import type { VCardContact } from '@shared/vcard'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { SearchService } from './search-service'

interface ContactRow {
  id: string
  name: string
  organisation: string
  role: string
  phones: string
  emails: string
  website: string
  address: string
  notes: string
  created_at: number
  updated_at: number
}

interface LinkRow {
  id: string
  project_id: string
  work_item_id: string
  contact_id: string
  role: TaskContactRole
  created_at: number
}

/** A card from a `.vcf` file and what importing it does: a new contact, or an update to one. */
export interface ContactImportChoice {
  card: VCardContact
  /** The contact whose email the card shares; null for a new contact. */
  updateId: string | null
}

export interface ContactsDependencies {
  getProjectIds(): string[]
  /** The task, or a refusal when there is none. */
  requireWorkItem(workItemId: string): PlanningWorkItem
  /** A task's contacts changed: its project's views read them again. */
  changed(projectId: string): void
  search: SearchService
}

/**
 * Contacts (N6.5, N48), on the planning connection: one list shared by every
 * project, and the tasks that name them with a role. Every surface (the app,
 * the automation API, the project file, vCard import) goes through here, so
 * the rules and the search index are the same everywhere. Contacts are not
 * People: nothing here touches assignees or Workload.
 */
export class ContactsService {
  constructor(
    private readonly db: Database.Database,
    private readonly deps: ContactsDependencies
  ) {}

  // ─── Contacts ─────────────────────────────────────────────────────────────

  /** Every contact by name, or those whose name, organisation, role, emails or phones match `query`. */
  list(query = ''): Contact[] {
    const rows = this.db
      .prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE, id')
      .all() as ContactRow[]
    const contacts = rows.map(toContact)
    const words = typeof query === 'string' ? query : ''
    return words.trim() ? contacts.filter((contact) => contactMatches(contact, words)) : contacts
  }

  get(contactId: string): Contact {
    return this.require(contactId)
  }

  create(input: unknown, now = Date.now()): Contact {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM contacts').get() as { n: number }).n
    if (count >= CONTACT_LIMITS.total)
      throw new Refusal(t('errors:contacts.tooMany', { max: CONTACT_LIMITS.total }))
    const values = this.validate(input, null)
    const id = uuidv4()
    this.db.transaction(() => {
      this.insert({ id, ...values, createdAt: now, updatedAt: now })
      this.deps.search.indexEntity('contact', id)
    })()
    return this.require(id)
  }

  update(contactId: string, input: unknown, now = Date.now()): Contact {
    const current = this.require(contactId)
    const values = this.validate(input, current)
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE contacts SET name = ?, organisation = ?, role = ?, phones = ?, emails = ?,
             website = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          values.name,
          values.organisation,
          values.role,
          JSON.stringify(values.phones),
          JSON.stringify(values.emails),
          values.website,
          values.address,
          values.notes,
          now,
          contactId
        )
      this.deps.search.indexEntity('contact', contactId)
    })()
    for (const projectId of this.projectsNaming(contactId)) this.deps.changed(projectId)
    return this.require(contactId)
  }

  /**
   * Deletes a contact and every task's link to it. Returns both, so Undo
   * (`restore`) can put them back; the app asks before it deletes.
   */
  delete(contactId: string): DeletedContact {
    const contact = this.require(contactId)
    const links = this.linksOf(contactId)
    this.db.transaction(() => {
      this.deps.search.removeEntity('contact', contactId)
      this.db.prepare('DELETE FROM contacts WHERE id = ?').run(contactId)
    })()
    for (const projectId of new Set(links.map((link) => link.projectId)))
      this.deps.changed(projectId)
    return { contact, links }
  }

  /** Undo of `delete`: the contact as it was, and its links to tasks that still exist. */
  restore(deleted: unknown): Contact {
    const input = deleted as DeletedContact | null
    if (
      !input ||
      typeof input !== 'object' ||
      !input.contact ||
      typeof input.contact.id !== 'string'
    )
      throw new Refusal(t('errors:contacts.notFound'))
    const { contact } = input
    if (this.db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(contact.id))
      return this.require(contact.id)
    const values = this.validate(contact, null)
    const links = Array.isArray(input.links) ? input.links : []
    const touched = new Set<string>()
    this.db.transaction(() => {
      this.insert({
        id: contact.id,
        ...values,
        createdAt: Number(contact.createdAt) || Date.now(),
        updatedAt: Number(contact.updatedAt) || Date.now()
      })
      this.deps.search.indexEntity('contact', contact.id)
      for (const link of links) if (this.reinsertLink(link)) touched.add(link.projectId)
    })()
    for (const projectId of touched) this.deps.changed(projectId)
    return this.require(contact.id)
  }

  // ─── Tasks' contacts ──────────────────────────────────────────────────────

  /** A task's contacts, in the order they were named, with the contacts themselves. */
  forTask(workItemId: string): TaskContact[] {
    const item = this.deps.requireWorkItem(workItemId)
    const rows = this.db
      .prepare(
        `SELECT l.*, c.id AS c_id, c.name, c.organisation, c.role AS c_role, c.phones, c.emails,
                c.website, c.address, c.notes, c.created_at AS c_created_at, c.updated_at AS c_updated_at
         FROM task_contacts l JOIN contacts c ON c.id = l.contact_id
         WHERE l.work_item_id = ? ORDER BY l.created_at, l.id`
      )
      .all(item.id) as (LinkRow & {
      c_id: string
      name: string
      organisation: string
      c_role: string
      phones: string
      emails: string
      website: string
      address: string
      notes: string
      c_created_at: number
      c_updated_at: number
    })[]
    return rows.map((row) => ({
      ...toLink(row),
      contact: toContact({
        id: row.c_id,
        name: row.name,
        organisation: row.organisation,
        role: row.c_role,
        phones: row.phones,
        emails: row.emails,
        website: row.website,
        address: row.address,
        notes: row.notes,
        created_at: row.c_created_at,
        updated_at: row.c_updated_at
      })
    }))
  }

  /** Which contacts each of a project's tasks names, in one query: the filter and the cards. */
  marksForProject(projectId: string): TaskContactMarks {
    const rows = this.db
      .prepare(
        'SELECT work_item_id, contact_id, role FROM task_contacts WHERE project_id = ? ORDER BY created_at, id'
      )
      .all(projectId) as { work_item_id: string; contact_id: string; role: TaskContactRole }[]
    const marks: TaskContactMarks = {}
    for (const row of rows)
      (marks[row.work_item_id] ??= []).push({ contactId: row.contact_id, role: row.role })
    return marks
  }

  /** Every link in a project, as stored: for the project file. */
  linksForProject(projectId: string): TaskContactLink[] {
    return (
      this.db
        .prepare('SELECT * FROM task_contacts WHERE project_id = ? ORDER BY created_at, id')
        .all(projectId) as LinkRow[]
    ).map(toLink)
  }

  /** The tasks that name a contact, in every project Ostler knows, newest link first. */
  tasksOf(contactId: string): ContactTask[] {
    this.require(contactId)
    const known = new Set(this.deps.getProjectIds())
    const rows = this.db
      .prepare(
        `SELECT l.id, l.project_id, l.work_item_id, l.role, w.title, w.status, w.archived_at, w.deleted_at
         FROM task_contacts l JOIN planning_work_items w ON w.id = l.work_item_id
         WHERE l.contact_id = ? ORDER BY l.created_at DESC, l.id`
      )
      .all(contactId) as {
      id: string
      project_id: string
      work_item_id: string
      role: TaskContactRole
      title: string
      status: PlanningWorkItemStatus
      archived_at: number | null
      deleted_at: number | null
    }[]
    return rows
      .filter((row) => known.has(row.project_id))
      .map((row) => ({
        linkId: row.id,
        projectId: row.project_id,
        workItemId: row.work_item_id,
        title: row.title,
        status: row.status,
        role: row.role,
        closed: row.archived_at !== null || row.deleted_at !== null
      }))
  }

  /** Names a contact on a task with a role; once per task, contact and role. */
  link(workItemId: string, contactId: unknown, role: unknown, now = Date.now()): TaskContact {
    const item = this.deps.requireWorkItem(workItemId)
    if (typeof contactId !== 'string') throw new Refusal(t('errors:contacts.notFound'))
    this.require(contactId)
    if (!isTaskContactRole(role)) throw new Refusal(t('errors:contacts.roleInvalid'))
    if (
      this.db
        .prepare(
          'SELECT 1 FROM task_contacts WHERE work_item_id = ? AND contact_id = ? AND role = ?'
        )
        .get(item.id, contactId, role)
    )
      throw new Refusal(t('errors:contacts.alreadyNamed'))
    const count = (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM task_contacts WHERE work_item_id = ?')
        .get(item.id) as { n: number }
    ).n
    if (count >= CONTACT_LIMITS.perTask)
      throw new Refusal(t('errors:contacts.tooManyOnTask', { max: CONTACT_LIMITS.perTask }))
    const id = uuidv4()
    this.db
      .prepare(
        'INSERT INTO task_contacts (id, project_id, work_item_id, contact_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, item.projectId, item.id, contactId, role, this.nextLinkTime(now))
    this.deps.changed(item.projectId)
    return this.forTask(item.id).find((entry) => entry.id === id)!
  }

  /** Takes a contact off a task; returns the link, so Undo (`relink`) can put it back. */
  unlink(workItemId: string, linkId: string): TaskContactLink {
    const item = this.deps.requireWorkItem(workItemId)
    const row = this.db
      .prepare('SELECT * FROM task_contacts WHERE id = ? AND work_item_id = ?')
      .get(linkId, item.id) as LinkRow | undefined
    if (!row) throw new Refusal(t('errors:contacts.linkNotFound'))
    this.db.prepare('DELETE FROM task_contacts WHERE id = ?').run(linkId)
    this.deps.changed(item.projectId)
    return toLink(row)
  }

  /** Undo of `unlink`: the same link again, when its task and contact still exist. */
  relink(workItemId: string, link: unknown): TaskContact[] {
    const item = this.deps.requireWorkItem(workItemId)
    const input = link as TaskContactLink | null
    if (!input || typeof input !== 'object' || input.workItemId !== item.id)
      throw new Refusal(t('errors:contacts.linkNotFound'))
    if (this.reinsertLink({ ...input, projectId: item.projectId }))
      this.deps.changed(item.projectId)
    return this.forTask(item.id)
  }

  // ─── Importing ────────────────────────────────────────────────────────────

  /** The contact a card's emails match, compared trimmed and in lower case; null when none does. */
  matchByEmail(emails: readonly string[]): Contact | null {
    return this.matchAllByEmail([emails])[0]
  }

  /** `matchByEmail` for many cards at once, reading the list once. */
  matchAllByEmail(cards: readonly (readonly string[])[]): (Contact | null)[] {
    const byEmail = new Map<string, Contact>()
    for (const contact of this.list())
      for (const email of contact.emails)
        if (!byEmail.has(emailKey(email))) byEmail.set(emailKey(email), contact)
    return cards.map(
      (emails) =>
        emails.map((email) => byEmail.get(emailKey(email))).find((found) => found !== undefined) ??
        null
    )
  }

  /**
   * Imports cards from a `.vcf` file, in one transaction: a new contact for
   * each card without `updateId`, and for each with one, that contact's
   * fields filled in from the card (its emails and phones added to the ones
   * it has). Returns the contacts made and updated.
   */
  importCards(choices: unknown): { created: Contact[]; updated: Contact[] } {
    if (!Array.isArray(choices) || choices.length > 5000)
      throw new Refusal(t('errors:contacts.importInvalid'))
    const created: string[] = []
    const updated: string[] = []
    this.db.transaction(() => {
      for (const choice of choices as ContactImportChoice[]) {
        const card = choice?.card
        if (!card || typeof card !== 'object') throw new Refusal(t('errors:contacts.importInvalid'))
        if (typeof choice.updateId === 'string') {
          const current = this.require(choice.updateId)
          this.update(current.id, mergeCard(current, card))
          updated.push(current.id)
        } else created.push(this.create(card).id)
      }
    })()
    return {
      created: created.map((id) => this.require(id)),
      updated: updated.map((id) => this.require(id))
    }
  }

  /**
   * The project file's contacts (N6.5), matched as people are: by email, or
   * by name when the contact has no email; the missing ones are created.
   * Returns each package contact's id, in order.
   */
  resolveForImport(contacts: readonly ContactInput[]): string[] {
    return contacts.map((input) => {
      const emails = (input.emails ?? []).filter((email) => typeof email === 'string')
      const byEmail = this.matchByEmail(emails)
      if (byEmail) return byEmail.id
      if (emails.length === 0 && typeof input.name === 'string') {
        const name = input.name.trim().toLowerCase()
        const byName = this.list().find(
          (contact) => contact.emails.length === 0 && contact.name.trim().toLowerCase() === name
        )
        if (byName) return byName.id
      }
      return this.create(input).id
    })
  }

  /** Writes a project file's links; one naming a task or contact that is gone is left out. */
  importLinks(
    projectId: string,
    links: readonly { workItemId: string; contactId: string; role: TaskContactRole }[]
  ): void {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO task_contacts (id, project_id, work_item_id, contact_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const now = this.nextLinkTime(Date.now())
    links.forEach((link, index) =>
      insert.run(uuidv4(), projectId, link.workItemId, link.contactId, link.role, now + index)
    )
  }

  // ─── Inside ───────────────────────────────────────────────────────────────

  /**
   * The time a new link is stored with: `now`, or just after the newest link
   * when that is not later. Every listing orders links by this time, so two
   * links named in the same millisecond must not tie (the id that would break
   * the tie is random).
   */
  private nextLinkTime(now: number): number {
    const latest = (
      this.db.prepare('SELECT MAX(created_at) AS latest FROM task_contacts').get() as {
        latest: number | null
      }
    ).latest
    return latest === null ? now : Math.max(now, latest + 1)
  }

  private require(contactId: unknown): Contact {
    if (typeof contactId !== 'string' || !contactId)
      throw new Refusal(t('errors:contacts.notFound'))
    const row = this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId) as
      ContactRow | undefined
    if (!row) throw new Refusal(t('errors:contacts.notFound'))
    return toContact(row)
  }

  private linksOf(contactId: string): TaskContactLink[] {
    return (
      this.db
        .prepare('SELECT * FROM task_contacts WHERE contact_id = ? ORDER BY created_at, id')
        .all(contactId) as LinkRow[]
    ).map(toLink)
  }

  private projectsNaming(contactId: string): string[] {
    return (
      this.db
        .prepare('SELECT DISTINCT project_id FROM task_contacts WHERE contact_id = ?')
        .all(contactId) as { project_id: string }[]
    ).map((row) => row.project_id)
  }

  /** Puts a stored link back when its task and contact exist and it is not there already. */
  private reinsertLink(link: TaskContactLink): boolean {
    if (!link || typeof link.id !== 'string' || !isTaskContactRole(link.role)) return false
    const task = this.db
      .prepare('SELECT project_id FROM planning_work_items WHERE id = ?')
      .get(link.workItemId) as { project_id: string } | undefined
    if (!task) return false
    return (
      this.db
        .prepare(
          `INSERT OR IGNORE INTO task_contacts (id, project_id, work_item_id, contact_id, role, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM contacts WHERE id = ?)`
        )
        .run(
          link.id,
          task.project_id,
          link.workItemId,
          link.contactId,
          link.role,
          Number(link.createdAt) || Date.now(),
          link.contactId
        ).changes > 0
    )
  }

  private insert(
    contact: Omit<Contact, 'phones' | 'emails'> & {
      phones: ContactPhone[]
      emails: string[]
    }
  ): void {
    this.db
      .prepare(
        `INSERT INTO contacts (id, name, organisation, role, phones, emails, website, address, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        contact.id,
        contact.name,
        contact.organisation,
        contact.role,
        JSON.stringify(contact.phones),
        JSON.stringify(contact.emails),
        contact.website,
        contact.address,
        contact.notes,
        contact.createdAt,
        contact.updatedAt
      )
  }

  /** Every field checked; a field left out keeps `current`'s value (or is empty for a new contact). */
  private validate(
    raw: unknown,
    current: Contact | null
  ): Omit<Contact, 'id' | 'createdAt' | 'updatedAt'> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Refusal(t('errors:contacts.inputInvalid'))
    const input = raw as Record<string, unknown>
    const textField = (
      key: keyof typeof CONTACT_LIMITS & keyof ContactInput,
      multiline = false
    ) => {
      const value = input[key]
      if (value === undefined) return current ? (current[key] as string) : ''
      if (typeof value !== 'string')
        throw new Refusal(t('errors:contacts.fieldText', { field: key }))
      const trimmed = multiline ? value.trim() : value.replace(/\s+/g, ' ').trim()
      const max = CONTACT_LIMITS[key] as number
      if (trimmed.length > max)
        throw new Refusal(t('errors:contacts.fieldTooLong', { field: key, max }))
      return trimmed
    }
    const name = textField('name')
    if (!name) throw new Refusal(t('errors:contacts.needsName'))
    const website = textField('website')
    if (website && websiteHref(website) === null)
      throw new Refusal(t('errors:contacts.websiteInvalid'))
    return {
      name,
      organisation: textField('organisation'),
      role: textField('role'),
      phones: input.phones === undefined ? (current?.phones ?? []) : phonesOf(input.phones),
      emails: input.emails === undefined ? (current?.emails ?? []) : emailsOf(input.emails),
      website,
      address: textField('address', true),
      notes: textField('notes', true)
    }
  }
}

function phonesOf(value: unknown): ContactPhone[] {
  if (!Array.isArray(value)) throw new Refusal(t('errors:contacts.phonesInvalid'))
  const phones = value
    .map((entry): ContactPhone => {
      if (!entry || typeof entry !== 'object') throw new Refusal(t('errors:contacts.phonesInvalid'))
      const { label = '', number } = entry as { label?: unknown; number?: unknown }
      if (typeof label !== 'string' || typeof number !== 'string')
        throw new Refusal(t('errors:contacts.phonesInvalid'))
      const phone = { label: label.trim(), number: number.trim() }
      if (
        phone.label.length > CONTACT_LIMITS.phoneLabel ||
        phone.number.length > CONTACT_LIMITS.phoneNumber
      )
        throw new Refusal(
          t('errors:contacts.phoneTooLong', {
            label: CONTACT_LIMITS.phoneLabel,
            number: CONTACT_LIMITS.phoneNumber
          })
        )
      return phone
    })
    .filter((phone) => phone.number !== '')
  if (phones.length > CONTACT_LIMITS.phones)
    throw new Refusal(t('errors:contacts.tooManyPhones', { max: CONTACT_LIMITS.phones }))
  return phones
}

function emailsOf(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Refusal(t('errors:contacts.emailsInvalid'))
  const emails: string[] = []
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string') throw new Refusal(t('errors:contacts.emailsInvalid'))
    const email = entry.trim()
    if (!email) continue
    // The message names the field, never the address: refusals are logged.
    if (!isEmailAddress(email))
      throw new Refusal(t('errors:contacts.emailInvalid', { n: index + 1 }))
    if (!emails.some((known) => emailKey(known) === emailKey(email))) emails.push(email)
  }
  if (emails.length > CONTACT_LIMITS.emails)
    throw new Refusal(t('errors:contacts.tooManyEmails', { max: CONTACT_LIMITS.emails }))
  return emails
}

/** A card over an existing contact: empty fields filled, emails and phones added, notes appended. */
function mergeCard(current: Contact, card: VCardContact): ContactInput {
  const emails = [...current.emails]
  for (const email of card.emails ?? [])
    if (!emails.some((known) => emailKey(known) === emailKey(email))) emails.push(email)
  const phones = [...current.phones]
  for (const phone of card.phones ?? [])
    if (
      !phones.some((known) => known.number.replace(/\D/g, '') === phone.number.replace(/\D/g, ''))
    )
      phones.push(phone)
  const notes =
    card.notes && !current.notes.includes(card.notes)
      ? [current.notes, card.notes].filter(Boolean).join('\n\n')
      : current.notes
  return {
    organisation: current.organisation || card.organisation || '',
    role: current.role || card.role || '',
    website: current.website || card.website || '',
    address: current.address || card.address || '',
    emails: emails.slice(0, CONTACT_LIMITS.emails),
    phones: phones.slice(0, CONTACT_LIMITS.phones),
    notes: notes.slice(0, CONTACT_LIMITS.notes)
  }
}

function parseList<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    name: row.name,
    organisation: row.organisation,
    role: row.role,
    phones: parseList<ContactPhone>(row.phones),
    emails: parseList<string>(row.emails),
    website: row.website,
    address: row.address,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toLink(row: LinkRow): TaskContactLink {
  return {
    id: row.id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    contactId: row.contact_id,
    role: row.role,
    createdAt: row.created_at
  }
}
