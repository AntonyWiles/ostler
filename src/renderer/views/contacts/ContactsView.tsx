import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  contactMatches,
  contactRoleLabel,
  contactSubtitle,
  mailtoHref,
  telHref,
  websiteHref,
  type Contact,
  type ContactTask
} from '@shared/contacts'
import { t } from '@shared/i18n'
import { useProjectList } from '../../context/OstlerContext'
import { ProjectMark } from '../../components/ProjectMark'
import { taskPath } from '../../navigation/paths'
import {
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  SearchField,
  useConfirm,
  useToast
} from '../../ui'
import { BookUser, Globe, Mail, Pencil, Phone, Plus, Trash2, Upload } from '../../ui/icons'
import { ContactForm, inputOf, type ContactDraft } from '../../contacts/ContactForm'
import { ImportContactsDialog } from '../../contacts/ImportContactsDialog'
import { useAccountsWith } from '../../accounts/useAccountsWith'
import { openContact, useContacts } from '../../contacts/useContacts'
import '../../contacts/contacts.css'

/**
 * Contacts (N6.5, N48): one list for every project of the people a project
 * involves who do no work in it. A searchable list beside the chosen
 * contact: every field to edit, Call, Email and Open website, and the tasks
 * that name it in any project. Contacts are not People: nothing is assigned
 * to them. `?contact=<id>` opens one (search and a task's Contacts section
 * link here).
 */
export function ContactsView() {
  const { contacts, reload } = useContacts()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<'new' | string | null>(null)
  const [importing, setImporting] = useState<'file' | 'account' | null>(null)
  const contactAccounts = useAccountsWith('contacts.read')
  const selectedId = params.get('contact')
  const selected = contacts?.find((contact) => contact.id === selectedId) ?? null
  const shown = useMemo(
    () => (contacts ?? []).filter((contact) => contactMatches(contact, query)),
    [contacts, query]
  )

  const select = (contactId: string | null) => {
    setEditing(null)
    setParams(contactId ? { contact: contactId } : {}, { replace: true })
  }

  return (
    <div className="contacts-view">
      <PageHeader
        title={t('views:contacts.title')}
        subtitle={t('views:contacts.subtitle')}
        actions={
          <>
            <Button variant="secondary" icon={Upload} onClick={() => setImporting('file')}>
              {t('views:contacts.import')}
            </Button>
            {contactAccounts.length > 0 && (
              <Button variant="secondary" icon={Upload} onClick={() => setImporting('account')}>
                {t('views:contacts.importFromAccount')}
              </Button>
            )}
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              {t('views:contacts.new')}
            </Button>
          </>
        }
      />
      <div className="contacts-view__body">
        <section className="contacts-view__list" aria-label={t('views:contacts.list')}>
          <SearchField
            label={t('views:contacts.search')}
            placeholder={t('views:contacts.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
          />
          {contacts !== null && contacts.length === 0 ? (
            <EmptyState
              icon={BookUser}
              headingLevel={3}
              title={t('views:contacts.emptyTitle')}
              description={t('views:contacts.emptyBody')}
            />
          ) : (
            <ul className="contacts-view__entries">
              {shown.map((contact) => (
                <li key={contact.id}>
                  <button
                    type="button"
                    className={`contacts-view__entry${contact.id === selectedId ? ' is-selected' : ''}`}
                    aria-current={contact.id === selectedId ? 'true' : undefined}
                    onClick={() => select(contact.id)}
                  >
                    <span className="contacts-view__name">{contact.name}</span>
                    {contactSubtitle(contact) && (
                      <span className="contacts-view__subtitle">{contactSubtitle(contact)}</span>
                    )}
                  </button>
                </li>
              ))}
              {contacts !== null && contacts.length > 0 && shown.length === 0 && (
                <li className="contacts-view__none">{t('views:contacts.noMatches')}</li>
              )}
            </ul>
          )}
        </section>
        <section className="contacts-view__detail" aria-label={t('views:contacts.detail')}>
          {editing === 'new' ? (
            <NewContact
              onCancel={() => setEditing(null)}
              onCreated={(contact) => {
                void reload()
                select(contact.id)
              }}
            />
          ) : selected ? (
            <ContactDetail
              key={selected.id}
              contact={selected}
              editing={editing === selected.id}
              setEditing={(on) => setEditing(on ? selected.id : null)}
              onChanged={() => void reload()}
              onDeleted={() => select(null)}
            />
          ) : (
            <p className="contacts-view__hint">{t('views:contacts.chooseOne')}</p>
          )}
        </section>
      </div>
      {importing && (
        <ImportContactsDialog
          accounts={importing === 'account' ? contactAccounts : undefined}
          onClose={() => setImporting(null)}
          onImported={() => {
            setImporting(null)
            void reload()
          }}
        />
      )}
    </div>
  )
}

function NewContact({
  onCancel,
  onCreated
}: {
  onCancel: () => void
  onCreated: (contact: Contact) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()
  const save = async (draft: ContactDraft) => {
    setSaving(true)
    const result = await window.ostlerAPI.createContact(inputOf(draft))
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast({ title: t('views:contacts.created', { name: result.value.name }) })
    onCreated(result.value)
  }
  return (
    <>
      <h2 className="contacts-view__heading">{t('views:contacts.newHeading')}</h2>
      <ContactForm contact={null} saving={saving} error={error} onSave={save} onCancel={onCancel} />
    </>
  )
}

/** One contact: its fields, Call, Email and Open website, its tasks, Edit and Delete. */
function ContactDetail({
  contact,
  editing,
  setEditing,
  onChanged,
  onDeleted
}: {
  contact: Contact
  editing: boolean
  setEditing: (on: boolean) => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const { toast, toastUndo } = useToast()
  const confirm = useConfirm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<ContactTask[] | null>(null)
  const projects = useProjectList()

  useEffect(() => {
    let cancelled = false
    const load = () =>
      void window.ostlerAPI.contactTasks(contact.id).then((result) => {
        if (!cancelled) setTasks(result.ok ? result.value : [])
      })
    load()
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'planning' || update.field === 'contacts') load()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [contact.id])

  const open = async (how: { kind: 'call' | 'email' | 'website'; index?: number }) => {
    const problem = await openContact(contact.id, how)
    if (problem) toast({ title: t('views:contacts.couldNotOpen'), body: problem, tone: 'danger' })
  }

  const save = async (draft: ContactDraft) => {
    setSaving(true)
    const before = contact
    const result = await window.ostlerAPI.updateContact(contact.id, inputOf(draft))
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setEditing(false)
    onChanged()
    toastUndo(t('views:contacts.saved', { name: result.value.name }), () =>
      window.ostlerAPI.updateContact(before.id, before).then(() => onChanged())
    )
  }

  const remove = async () => {
    const count = tasks?.length ?? 0
    const ok = await confirm({
      title: t('views:contacts.deleteTitle', { name: contact.name }),
      body:
        count > 0 ? t('views:contacts.deleteBodyTasks', { count }) : t('views:contacts.deleteBody'),
      confirmLabel: t('views:contacts.delete'),
      tone: 'danger'
    })
    if (!ok) return
    const result = await window.ostlerAPI.deleteContact(contact.id)
    if (!result.ok) {
      toast({ title: t('views:contacts.couldNotDelete'), body: result.error, tone: 'danger' })
      return
    }
    onDeleted()
    onChanged()
    toastUndo(t('views:contacts.deleted', { name: contact.name }), () =>
      window.ostlerAPI.restoreContact(result.value).then(() => onChanged())
    )
  }

  if (editing)
    return (
      <>
        <h2 className="contacts-view__heading">{contact.name}</h2>
        <ContactForm
          contact={contact}
          saving={saving}
          error={error}
          onSave={save}
          onCancel={() => {
            setError(null)
            setEditing(false)
          }}
        />
      </>
    )

  const website = websiteHref(contact.website)
  const projectOf = (projectId: string) => projects.find((project) => project.id === projectId)
  return (
    <article className="contact-detail" aria-labelledby="contact-detail-name">
      <header className="contact-detail__header">
        <div>
          <h2 id="contact-detail-name" className="contacts-view__heading">
            {contact.name}
          </h2>
          {contactSubtitle(contact) && (
            <p className="contact-detail__subtitle">{contactSubtitle(contact)}</p>
          )}
        </div>
        <div className="contact-detail__actions">
          <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
            {t('views:contacts.edit')}
          </Button>
          <IconButton
            icon={Trash2}
            variant="danger"
            label={t('views:contacts.deleteNamed', { name: contact.name })}
            onClick={() => void remove()}
          />
        </div>
      </header>
      <dl className="contact-detail__fields">
        {contact.phones.length > 0 && (
          <>
            <dt>{t('views:contacts.phones')}</dt>
            <dd>
              <ul className="contact-detail__lines">
                {contact.phones.map((phone, index) => (
                  <li key={index}>
                    <span>
                      {phone.label && <span className="contact-detail__label">{phone.label}</span>}
                      {phone.number}
                    </span>
                    {telHref(phone.number) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Phone}
                        aria-label={t('views:contacts.callNumber', { number: phone.number })}
                        onClick={() => void open({ kind: 'call', index })}
                      >
                        {t('views:contacts.call')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {contact.emails.length > 0 && (
          <>
            <dt>{t('views:contacts.emails')}</dt>
            <dd>
              <ul className="contact-detail__lines">
                {contact.emails.map((email, index) => (
                  <li key={email}>
                    <span>{email}</span>
                    {mailtoHref(email) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Mail}
                        aria-label={t('views:contacts.emailAddress', { email })}
                        onClick={() => void open({ kind: 'email', index })}
                      >
                        {t('views:contacts.sendEmail')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {contact.website && (
          <>
            <dt>{t('views:contacts.website')}</dt>
            <dd>
              <ul className="contact-detail__lines">
                <li>
                  <span>{contact.website}</span>
                  {website && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Globe}
                      onClick={() => void open({ kind: 'website' })}
                    >
                      {t('views:contacts.openWebsite')}
                    </Button>
                  )}
                </li>
              </ul>
            </dd>
          </>
        )}
        {contact.address && (
          <>
            <dt>{t('views:contacts.address')}</dt>
            <dd className="contact-detail__text">{contact.address}</dd>
          </>
        )}
        {contact.notes && (
          <>
            <dt>{t('views:contacts.notes')}</dt>
            <dd className="contact-detail__text">{contact.notes}</dd>
          </>
        )}
      </dl>
      <section className="contact-detail__tasks" aria-labelledby="contact-detail-tasks">
        <h3 id="contact-detail-tasks">{t('views:contacts.tasks')}</h3>
        {tasks !== null && tasks.length === 0 && (
          <p className="contact-detail__subtitle">{t('views:contacts.noTasks')}</p>
        )}
        {tasks !== null && tasks.length > 0 && (
          <ul className="contact-detail__task-list">
            {tasks.map((task) => {
              const project = projectOf(task.projectId)
              return (
                <li key={task.linkId} className={task.closed ? 'is-closed' : undefined}>
                  <Link to={taskPath(task.projectId, task.workItemId)}>{task.title}</Link>
                  <span className="contact-detail__task-meta">
                    {contactRoleLabel(task.role)}
                    {project && (
                      <span className="contact-detail__project">
                        <ProjectMark project={project} className="contact-detail__dot" />
                        {project.name}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </article>
  )
}
