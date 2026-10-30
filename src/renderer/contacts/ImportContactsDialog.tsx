import { useEffect, useState } from 'react'
import { contactSubtitle, type Contact } from '@shared/contacts'
import type { VCardContact } from '@shared/vcard'
import { t } from '@shared/i18n'
import type { ConnectedAccount } from '@shared/ostler-api'
import { Button, Checkbox, Dialog, Select, Spinner, useToast } from '../ui'
import { accountName } from '../accounts/useAccountsWith'

interface PreviewCard {
  card: VCardContact
  match: Contact | null
  include: boolean
  /** For a card whose email matches a contact: update it, or add a new one. */
  update: boolean
}

/**
 * Import contacts… (N6.5): asks for a `.vcf` file, then shows what it holds
 * before anything is saved. A card whose email matches an existing contact
 * is offered as an update to it, not a duplicate; each card can be left out.
 *
 * Import from an account… (integrations phase 2) passes `accounts`: the
 * cards come from the chosen connected account instead, read in main, and
 * the same preview and rules follow. Nothing is written to the account.
 */
export function ImportContactsDialog({
  onClose,
  onImported,
  accounts
}: {
  onClose: () => void
  onImported: () => void
  /** Connected accounts with `contacts.read`; reads from the first unless one is picked. */
  accounts?: ConnectedAccount[]
}) {
  const [accountId, setAccountId] = useState(accounts?.[0]?.id ?? null)
  const { toast } = useToast()
  const [preview, setPreview] = useState<{
    fileName: string
    cards: PreviewCard[]
    skipped: number
    tooManyCards: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setError(null)
    void (
      accountId ? window.ostlerAPI.readAccountContacts(accountId) : window.ostlerAPI.readVCardFile()
    ).then((result) => {
      if (cancelled) return
      if (!result.ok) setError(result.error)
      else if (result.value === null) onClose()
      else
        setPreview({
          ...result.value,
          cards: result.value.cards.map((entry) => ({
            ...entry,
            include: true,
            update: entry.match !== null
          }))
        })
    })
    return () => {
      cancelled = true
    }
    // Asks for the file once, when the dialog opens; an account is read again when another is picked.
  }, [accountId])

  const change = (index: number, patch: Partial<PreviewCard>) =>
    setPreview((current) =>
      current
        ? {
            ...current,
            cards: current.cards.map((entry, at) => (at === index ? { ...entry, ...patch } : entry))
          }
        : current
    )

  const chosen = preview?.cards.filter((entry) => entry.include) ?? []
  const save = async () => {
    setSaving(true)
    const result = await window.ostlerAPI.importContacts(
      chosen.map((entry) => ({
        card: entry.card,
        updateId: entry.update && entry.match ? entry.match.id : null
      }))
    )
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast({
      title: t('views:contacts.imported', {
        created: result.value.created.length,
        updated: result.value.updated.length
      })
    })
    onImported()
  }

  if (!preview && !error && !accountId) return null
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={t('views:contacts.importTitle')}
      description={preview ? t('views:contacts.importFrom', { file: preview.fileName }) : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('views:contacts.cancel')}
          </Button>
          {preview && (
            <Button
              variant="primary"
              disabled={saving || chosen.length === 0}
              onClick={() => void save()}
            >
              {saving ? <Spinner size="sm" /> : null}
              {t('views:contacts.importCount', { count: chosen.length })}
            </Button>
          )}
        </>
      }
    >
      {accounts && accounts.length > 1 && (
        <Select
          label={t('views:contacts.importAccount')}
          options={accounts.map((account) => ({
            value: account.id,
            label: accountName(account, t)
          }))}
          value={accountId ?? ''}
          disabled={saving}
          onChange={(event) => setAccountId(event.target.value)}
        />
      )}
      {accountId && !preview && !error && (
        <p className="contact-import__note">
          <Spinner size="sm" /> {t('views:contacts.importReading')}
        </p>
      )}
      {error && (
        <p className="contact-form__error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          {(preview.skipped > 0 || preview.tooManyCards) && (
            <p className="contact-import__note">
              {preview.tooManyCards
                ? t('views:contacts.importTooMany', { count: preview.skipped })
                : t('views:contacts.importSkipped', { count: preview.skipped })}
            </p>
          )}
          <ul className="contact-import__cards" aria-label={t('views:contacts.importCards')}>
            {preview.cards.map((entry, index) => (
              <li key={index} className="contact-import__card">
                <Checkbox
                  label={entry.card.name}
                  hint={
                    [contactSubtitle(entry.card), ...entry.card.emails]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                  checked={entry.include}
                  onChange={(event) => change(index, { include: event.target.checked })}
                />
                {entry.match && (
                  <Select
                    size="sm"
                    label={t('views:contacts.importMatchLabel', { name: entry.card.name })}
                    hideLabel
                    disabled={!entry.include}
                    value={entry.update ? 'update' : 'new'}
                    onChange={(event) => change(index, { update: event.target.value === 'update' })}
                    options={[
                      {
                        value: 'update',
                        label: t('views:contacts.importUpdate', { name: entry.match.name })
                      },
                      { value: 'new', label: t('views:contacts.importAsNew') }
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  )
}
