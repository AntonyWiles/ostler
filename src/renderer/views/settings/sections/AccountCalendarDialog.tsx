import { useEffect, useState } from 'react'
import type { AccountCalendarChoice, ConnectedAccount, OutsideCalendar } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Button, Dialog, Select } from '../../../ui'
import { accountName } from '../../../accounts/useAccountsWith'

/**
 * Add from an account… (integrations phase 1): pick a connected account that
 * can read calendars, then one of its calendars. Main reads its events once
 * and adds it only if that worked; already added ones say so.
 */
export function AccountCalendarDialog({
  accounts,
  onClose,
  onAdded
}: {
  /** Connected accounts with `calendar.read`. */
  accounts: ConnectedAccount[]
  onClose: () => void
  onAdded: (calendar: OutsideCalendar) => Promise<void>
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [choices, setChoices] = useState<AccountCalendarChoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) return
    let current = true
    setChoices(null)
    setError(null)
    void window.ostlerAPI.listAccountCalendars(accountId).then((result) => {
      if (!current) return
      if (result.ok) setChoices(result.value)
      else setError(result.error)
    })
    return () => {
      current = false
    }
  }, [accountId])

  const add = async (choice: AccountCalendarChoice) => {
    setAdding(choice.remoteId)
    setError(null)
    const result = await window.ostlerAPI.addAccountCalendar({
      accountId,
      remoteId: choice.remoteId,
      // The colour comes from Ostler's palette, as for any calendar.
      name: choice.name
    })
    setAdding(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onAdded(result.value)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={adding === null}
      title={t('settings:calendars.accountTitle')}
      description={t('settings:calendars.accountDescription')}
      footer={
        <Button variant="secondary" onClick={onClose} disabled={adding !== null}>
          {t('settings:calendars.cancel')}
        </Button>
      }
    >
      <div className="ostler-calendars__add">
        {accounts.length > 1 && (
          <Select
            label={t('settings:calendars.accountLabel')}
            options={accounts.map((account) => ({
              value: account.id,
              label: accountName(account, t)
            }))}
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          />
        )}
        {choices === null && !error && <p>{t('settings:calendars.accountLoading')}</p>}
        {choices?.length === 0 && <p>{t('settings:calendars.accountNone')}</p>}
        {choices && choices.length > 0 && (
          <ul className="ostler-settings-people" aria-label={t('settings:calendars.accountList')}>
            {choices.map((choice) => (
              <li key={choice.remoteId} className="ostler-settings-person">
                <span
                  className="ostler-calendars__mark"
                  style={{ backgroundColor: choice.color ?? 'transparent' }}
                  aria-hidden="true"
                />
                <span className="ostler-settings-person-name">{choice.name}</span>
                <div className="ostler-settings-person-actions">
                  {choice.added ? (
                    <span className="ostler-settings-person-capacity">
                      {t('settings:calendars.accountAdded')}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      loading={adding === choice.remoteId}
                      disabled={adding !== null}
                      aria-label={t('settings:calendars.accountAddLabel', { name: choice.name })}
                      onClick={() => void add(choice)}
                    >
                      {t('settings:calendars.accountAdd')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="ostler-calendars__hint">{t('settings:calendars.accountPrivacy')}</p>
        {error && (
          <p className="ostler-calendars__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
