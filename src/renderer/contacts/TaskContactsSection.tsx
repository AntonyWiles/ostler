import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PlanningWorkItem } from '@shared/ostler-api'
import {
  TASK_CONTACT_ROLES,
  contactRoleLabel,
  contactSubtitle,
  mailtoHref,
  telHref,
  type TaskContact,
  type TaskContactRole
} from '@shared/contacts'
import { t } from '@shared/i18n'
import { contactsPath } from '../navigation/paths'
import { Button, Combobox, IconButton, Select, useToast } from '../ui'
import { Mail, Phone, Plus, X } from '../ui/icons'
import { TaskDrawerSection } from '../views/planning/TaskDrawerSection'
import { openContact, useContacts } from './useContacts'
import './contacts.css'

/**
 * The drawer's Contacts section (N6.5): who asked for the task, who supplies
 * it, and anyone else it involves. Each shows with their organisation, Call
 * and Email; Remove has Undo. Name one by searching as you type, or make a
 * new contact inline. Contacts are their own records, so links save at once.
 */
export function TaskContactsSection({ item }: { item: PlanningWorkItem }) {
  const { toast, toastUndo } = useToast()
  const { contacts, reload: reloadContacts } = useContacts()
  const [links, setLinks] = useState<TaskContact[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [contactId, setContactId] = useState<string | null>(null)
  const [role, setRole] = useState<TaskContactRole>('asked-for-it')
  const closed = Boolean(item.archivedAt) || Boolean(item.deletedAt)

  const reload = useCallback(async () => {
    if (typeof window.ostlerAPI.taskContacts !== 'function') return setLinks([])
    const result = await window.ostlerAPI.taskContacts(item.projectId, item.id)
    setLinks(result.ok ? result.value : [])
  }, [item.projectId, item.id])

  useEffect(() => {
    void reload()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (
        update.field === 'contacts' ||
        (update.field === 'planning' && update.projectId === item.projectId)
      )
        void reload()
    })
  }, [reload, item.projectId])

  const options = useMemo(
    () =>
      (contacts ?? []).map((contact) => ({
        value: contact.id,
        label: contact.name,
        description: contactSubtitle(contact) || undefined
      })),
    [contacts]
  )

  const fail = (title: string, body: string) => toast({ title, body, tone: 'danger' })

  const add = async () => {
    if (!contactId) return
    const result = await window.ostlerAPI.linkTaskContact(item.projectId, item.id, contactId, role)
    if (!result.ok) return fail(t('tasks:taskContacts.couldNotAdd'), result.error)
    setContactId(null)
    setAdding(false)
    void reload()
  }

  const create = async (name: string) => {
    const result = await window.ostlerAPI.createContact({ name })
    if (!result.ok) return fail(t('tasks:taskContacts.couldNotCreate'), result.error)
    await reloadContacts()
    setContactId(result.value.id)
  }

  const remove = async (link: TaskContact) => {
    const result = await window.ostlerAPI.unlinkTaskContact(item.projectId, item.id, link.id)
    if (!result.ok) return fail(t('tasks:taskContacts.couldNotRemove'), result.error)
    void reload()
    toastUndo(t('tasks:taskContacts.removed', { name: link.contact.name }), () =>
      window.ostlerAPI.relinkTaskContact(item.projectId, item.id, result.value).then(() => reload())
    )
  }

  const open = async (id: string, how: { kind: 'call' | 'email'; index: number }) => {
    const problem = await openContact(id, how)
    if (problem) fail(t('views:contacts.couldNotOpen'), problem)
  }

  return (
    <TaskDrawerSection
      title={t('tasks:taskContacts.title')}
      className="task-contacts"
      part={{
        id: 'contacts',
        inUse: (links ?? []).length > 0,
        start: closed ? undefined : () => setAdding(true)
      }}
      actions={
        <>
          <Link className="task-contacts__all" to={contactsPath()}>
            {t('tasks:taskContacts.allContacts')}
          </Link>
          {!closed && !adding && (
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdding(true)}>
              {t('tasks:taskContacts.add')}
            </Button>
          )}
        </>
      }
    >
      {links !== null && links.length === 0 && !adding && (
        <p className="task-contacts__empty">{t('tasks:taskContacts.none')}</p>
      )}
      {links !== null && links.length > 0 && (
        <ul className="task-contacts__list" aria-label={t('tasks:taskContacts.title')}>
          {links.map((link) => {
            const phone = link.contact.phones.find((entry) => telHref(entry.number))
            const email = link.contact.emails.find((entry) => mailtoHref(entry))
            const subtitle = contactSubtitle(link.contact)
            return (
              <li key={link.id} className="task-contacts__entry">
                <span className="task-contacts__who">
                  <Link to={contactsPath(link.contactId)}>{link.contact.name}</Link>
                  <span className="task-contacts__meta">
                    {[contactRoleLabel(link.role), subtitle].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="task-contacts__actions">
                  {phone && (
                    <IconButton
                      size="sm"
                      icon={Phone}
                      label={t('tasks:taskContacts.call', {
                        name: link.contact.name,
                        number: phone.number
                      })}
                      onClick={() =>
                        void open(link.contactId, {
                          kind: 'call',
                          index: link.contact.phones.indexOf(phone)
                        })
                      }
                    />
                  )}
                  {email && (
                    <IconButton
                      size="sm"
                      icon={Mail}
                      label={t('tasks:taskContacts.email', { name: link.contact.name, email })}
                      onClick={() =>
                        void open(link.contactId, {
                          kind: 'email',
                          index: link.contact.emails.indexOf(email)
                        })
                      }
                    />
                  )}
                  {!closed && (
                    <IconButton
                      size="sm"
                      icon={X}
                      label={t('tasks:taskContacts.remove', {
                        name: link.contact.name,
                        role: contactRoleLabel(link.role)
                      })}
                      onClick={() => void remove(link)}
                    />
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {adding && (
        <div className="task-contacts__add">
          <Combobox
            label={t('tasks:taskContacts.contact')}
            options={options}
            value={contactId}
            onChange={setContactId}
            onCreate={(text) => void create(text)}
            createLabel={(text) => t('tasks:taskContacts.createNamed', { name: text })}
            placeholder={t('tasks:taskContacts.searchPlaceholder')}
            emptyText={t('tasks:taskContacts.noMatch')}
          />
          <Select
            label={t('tasks:taskContacts.role')}
            value={role}
            onChange={(event) => setRole(event.target.value as TaskContactRole)}
            options={TASK_CONTACT_ROLES.map((value) => ({
              value,
              label: contactRoleLabel(value)
            }))}
          />
          <div className="task-contacts__add-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false)
                setContactId(null)
              }}
            >
              {t('tasks:taskContacts.cancel')}
            </Button>
            <Button size="sm" variant="primary" disabled={!contactId} onClick={() => void add()}>
              {t('tasks:taskContacts.name')}
            </Button>
          </div>
        </div>
      )}
    </TaskDrawerSection>
  )
}
