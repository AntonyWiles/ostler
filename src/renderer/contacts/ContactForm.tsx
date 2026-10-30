import { useState, type FormEvent } from 'react'
import {
  CONTACT_LIMITS,
  type Contact,
  type ContactInput,
  type ContactPhone
} from '@shared/contacts'
import { t } from '@shared/i18n'
import { Button, IconButton, TextArea, TextField } from '../ui'
import { Plus, X } from '../ui/icons'

/** The fields a contact's form edits, as typed. */
export interface ContactDraft {
  name: string
  organisation: string
  role: string
  phones: ContactPhone[]
  emails: string[]
  website: string
  address: string
  notes: string
}

export function draftOf(contact: Contact | null): ContactDraft {
  return {
    name: contact?.name ?? '',
    organisation: contact?.organisation ?? '',
    role: contact?.role ?? '',
    phones: contact ? contact.phones.map((phone) => ({ ...phone })) : [],
    emails: contact ? [...contact.emails] : [],
    website: contact?.website ?? '',
    address: contact?.address ?? '',
    notes: contact?.notes ?? ''
  }
}

/** The draft as what the service takes: empty phones and emails left out. */
export function inputOf(draft: ContactDraft): ContactInput {
  return {
    ...draft,
    phones: draft.phones.filter((phone) => phone.number.trim() !== ''),
    emails: draft.emails.filter((email) => email.trim() !== '')
  }
}

/**
 * Every field of a contact (N6.5): name, organisation, role, phones with
 * their labels, emails, website, address and notes. Saved with Save; the
 * service checks every field, and its refusal shows under the form.
 */
export function ContactForm({
  contact,
  saving,
  error,
  onSave,
  onCancel
}: {
  contact: Contact | null
  saving: boolean
  error: string | null
  onSave: (draft: ContactDraft) => void
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState<ContactDraft>(() => draftOf(contact))
  const set = <K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave(draft)
  }
  const nameMissing = draft.name.trim() === ''

  return (
    <form className="contact-form" onSubmit={submit} aria-label={t('views:contacts.form')}>
      <TextField
        label={t('views:contacts.name')}
        value={draft.name}
        maxLength={CONTACT_LIMITS.name}
        required
        data-autofocus
        onChange={(event) => set('name', event.target.value)}
      />
      <div className="contact-form__pair">
        <TextField
          label={t('views:contacts.organisation')}
          value={draft.organisation}
          maxLength={CONTACT_LIMITS.organisation}
          onChange={(event) => set('organisation', event.target.value)}
        />
        <TextField
          label={t('views:contacts.role')}
          hint={t('views:contacts.roleHint')}
          value={draft.role}
          maxLength={CONTACT_LIMITS.role}
          onChange={(event) => set('role', event.target.value)}
        />
      </div>
      <fieldset className="contact-form__group">
        <legend>{t('views:contacts.phones')}</legend>
        {draft.phones.map((phone, index) => (
          <div key={index} className="contact-form__row">
            <TextField
              label={t('views:contacts.phoneLabel', { n: index + 1 })}
              placeholder={t('views:contacts.phoneLabelPlaceholder')}
              className="contact-form__label"
              value={phone.label}
              maxLength={CONTACT_LIMITS.phoneLabel}
              onChange={(event) =>
                set(
                  'phones',
                  draft.phones.map((entry, at) =>
                    at === index ? { ...entry, label: event.target.value } : entry
                  )
                )
              }
            />
            <TextField
              label={t('views:contacts.phoneNumber', { n: index + 1 })}
              type="tel"
              value={phone.number}
              maxLength={CONTACT_LIMITS.phoneNumber}
              onChange={(event) =>
                set(
                  'phones',
                  draft.phones.map((entry, at) =>
                    at === index ? { ...entry, number: event.target.value } : entry
                  )
                )
              }
            />
            <IconButton
              size="sm"
              icon={X}
              label={t('views:contacts.removePhone', { n: index + 1 })}
              onClick={() =>
                set(
                  'phones',
                  draft.phones.filter((_entry, at) => at !== index)
                )
              }
            />
          </div>
        ))}
        {draft.phones.length < CONTACT_LIMITS.phones && (
          <Button
            size="sm"
            variant="ghost"
            icon={Plus}
            onClick={() => set('phones', [...draft.phones, { label: '', number: '' }])}
          >
            {t('views:contacts.addPhone')}
          </Button>
        )}
      </fieldset>
      <fieldset className="contact-form__group">
        <legend>{t('views:contacts.emails')}</legend>
        {draft.emails.map((email, index) => (
          <div key={index} className="contact-form__row">
            <TextField
              label={t('views:contacts.email', { n: index + 1 })}
              type="email"
              value={email}
              maxLength={CONTACT_LIMITS.email}
              onChange={(event) =>
                set(
                  'emails',
                  draft.emails.map((entry, at) => (at === index ? event.target.value : entry))
                )
              }
            />
            <IconButton
              size="sm"
              icon={X}
              label={t('views:contacts.removeEmail', { n: index + 1 })}
              onClick={() =>
                set(
                  'emails',
                  draft.emails.filter((_entry, at) => at !== index)
                )
              }
            />
          </div>
        ))}
        {draft.emails.length < CONTACT_LIMITS.emails && (
          <Button
            size="sm"
            variant="ghost"
            icon={Plus}
            onClick={() => set('emails', [...draft.emails, ''])}
          >
            {t('views:contacts.addEmail')}
          </Button>
        )}
      </fieldset>
      <TextField
        label={t('views:contacts.website')}
        value={draft.website}
        maxLength={CONTACT_LIMITS.website}
        onChange={(event) => set('website', event.target.value)}
      />
      <TextArea
        label={t('views:contacts.address')}
        rows={3}
        value={draft.address}
        maxLength={CONTACT_LIMITS.address}
        onChange={(event) => set('address', event.target.value)}
      />
      <TextArea
        label={t('views:contacts.notes')}
        rows={4}
        value={draft.notes}
        maxLength={CONTACT_LIMITS.notes}
        onChange={(event) => set('notes', event.target.value)}
      />
      {error && (
        <p className="contact-form__error" role="alert">
          {error}
        </p>
      )}
      <div className="contact-form__actions">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('views:contacts.cancel')}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={saving || nameMissing}>
          {contact ? t('views:contacts.save') : t('views:contacts.create')}
        </Button>
      </div>
    </form>
  )
}
