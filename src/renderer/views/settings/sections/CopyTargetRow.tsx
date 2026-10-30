import { useCallback, useEffect, useState } from 'react'
import type { AccountFailure, ConnectedAccount } from '@shared/ostler-api'
import { formatRelativeTime } from '@shared/format'
import { t } from '@shared/i18n'
import { Button, Dialog, Select, useConfirm } from '../../../ui'
import { accountName } from '../../../accounts/useAccountsWith'
import './CalendarsGroup.css'

/** Where Ostler copies something into an account: a calendar, or a task list. */
interface CopyTarget {
  accountId: string
  name: string
  syncedAt: number | null
  failedAt: number | null
  failure: AccountFailure | null
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

interface CopyWords {
  title: string
  description: string
  into(name: string, account: string): string
  synced(when: string): string
  notYet: string
  failedLine(when: string, reason: string): string
  choose: string
  change: string
  stop: string
  stopTitle: string
  stopBody: string
  chooseTitle: string
  chooseDescription: string
  picker: string
  loading: string
  none: string
  privacy: string
}

/** What differs between copying time blocks and copying my tasks. */
export interface CopyKind {
  /** The words, each from its own key so the translation check can see them. */
  words(): CopyWords
  get(): Promise<Result<CopyTarget | null>>
  set(
    input: { accountId: string; remoteId: string; name: string } | null
  ): Promise<Result<CopyTarget | null>>
  choices(accountId: string): Promise<Result<{ remoteId: string; name: string }[]>>
}

/** Time blocks into a calendar (integrations phase 6). */
export const TIME_BLOCKS_INTO_CALENDAR: CopyKind = {
  words: () => ({
    title: t('settings:calendarWrite.title'),
    description: t('settings:calendarWrite.description'),
    into: (name, account) => t('settings:calendarWrite.into', { name, account }),
    synced: (when) => t('settings:calendarWrite.synced', { when }),
    notYet: t('settings:calendarWrite.notYet'),
    failedLine: (when, reason) => t('settings:calendarWrite.failedLine', { when, reason }),
    choose: t('settings:calendarWrite.choose'),
    change: t('settings:calendarWrite.change'),
    stop: t('settings:calendarWrite.stop'),
    stopTitle: t('settings:calendarWrite.stopTitle'),
    stopBody: t('settings:calendarWrite.stopBody'),
    chooseTitle: t('settings:calendarWrite.chooseTitle'),
    chooseDescription: t('settings:calendarWrite.chooseDescription'),
    picker: t('settings:calendarWrite.picker'),
    loading: t('settings:calendarWrite.loading'),
    none: t('settings:calendarWrite.none'),
    privacy: t('settings:calendarWrite.privacy')
  }),
  get: () => window.ostlerAPI.getCalendarWriteTarget(),
  set: (input) => window.ostlerAPI.setCalendarWriteTarget(input),
  choices: (accountId) => window.ostlerAPI.listAccountCalendars(accountId)
}

/** My open tasks into To Do or Google Tasks (integrations phase 6). */
export const MY_TASKS_INTO_LIST: CopyKind = {
  words: () => ({
    title: t('settings:taskList.title'),
    description: t('settings:taskList.description'),
    into: (name, account) => t('settings:taskList.into', { name, account }),
    synced: (when) => t('settings:taskList.synced', { when }),
    notYet: t('settings:taskList.notYet'),
    failedLine: (when, reason) => t('settings:taskList.failedLine', { when, reason }),
    choose: t('settings:taskList.choose'),
    change: t('settings:taskList.change'),
    stop: t('settings:taskList.stop'),
    stopTitle: t('settings:taskList.stopTitle'),
    stopBody: t('settings:taskList.stopBody'),
    chooseTitle: t('settings:taskList.chooseTitle'),
    chooseDescription: t('settings:taskList.chooseDescription'),
    picker: t('settings:taskList.picker'),
    loading: t('settings:taskList.loading'),
    none: t('settings:taskList.none'),
    privacy: t('settings:taskList.privacy')
  }),
  get: () => window.ostlerAPI.getTaskListTarget(),
  set: (input) => window.ostlerAPI.setTaskListTarget(input),
  choices: (accountId) => window.ostlerAPI.listTaskLists(accountId)
}

/**
 * Writing back (integrations phase 6): copies time blocks into a calendar, or
 * my open tasks into a task list, of an account that allows it. Shown only
 * once such an account is connected. Stop deletes the copies.
 */
export function CopyTargetRow({
  kind,
  accounts
}: {
  kind: CopyKind
  accounts: ConnectedAccount[]
}) {
  const confirm = useConfirm()
  const [target, setTarget] = useState<CopyTarget | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const w = kind.words()

  const load = useCallback(async () => {
    const result = await kind.get()
    if (result.ok) setTarget(result.value)
  }, [kind])

  useEffect(() => {
    void load()
  }, [load])

  const stop = async () => {
    const ok = await confirm({
      title: w.stopTitle,
      body: w.stopBody,
      confirmLabel: w.stop
    })
    if (!ok) return
    const result = await kind.set(null)
    if (result.ok) setTarget(null)
    else setError(result.error)
  }

  const account = target ? accounts.find((entry) => entry.id === target.accountId) : undefined
  return (
    <div className="ostler-calendars__write">
      <span className="ostler-settings-person-name">
        {w.title}
        <span className="ostler-settings-person-capacity">
          {target
            ? [
                w.into(target.name, account ? accountName(account, t) : ''),
                target.failure
                  ? w.failedLine(
                      formatRelativeTime(target.failedAt ?? Date.now()),
                      t(`errors:accounts.failure.${target.failure}`)
                    )
                  : target.syncedAt
                    ? w.synced(formatRelativeTime(target.syncedAt))
                    : w.notYet
              ].join(' · ')
            : w.description}
        </span>
        {error && (
          <span className="ostler-calendars__failure" role="alert">
            {error}
          </span>
        )}
      </span>
      <div className="ostler-settings-person-actions">
        <Button size="sm" onClick={() => setChoosing(true)}>
          {target ? w.change : w.choose}
        </Button>
        {target && (
          <Button size="sm" onClick={() => void stop()}>
            {w.stop}
          </Button>
        )}
      </div>
      {choosing && (
        <ChooseDialog
          kind={kind}
          accounts={accounts}
          onClose={() => setChoosing(false)}
          onChosen={(chosen) => {
            setChoosing(false)
            setTarget(chosen)
          }}
        />
      )}
    </div>
  )
}

function ChooseDialog({
  kind,
  accounts,
  onClose,
  onChosen
}: {
  kind: CopyKind
  accounts: ConnectedAccount[]
  onClose: () => void
  onChosen: (target: CopyTarget | null) => void
}) {
  const w = kind.words()
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [choices, setChoices] = useState<{ remoteId: string; name: string }[] | null>(null)
  const [remoteId, setRemoteId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!accountId) return
    let current = true
    setChoices(null)
    setRemoteId('')
    void kind.choices(accountId).then((result) => {
      if (!current) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      setChoices(result.value)
      setRemoteId(result.value[0]?.remoteId ?? '')
    })
    return () => {
      current = false
    }
  }, [accountId, kind])

  const save = async () => {
    const choice = choices?.find((entry) => entry.remoteId === remoteId)
    if (!choice) return
    setSaving(true)
    setError(null)
    const result = await kind.set({ accountId, remoteId: choice.remoteId, name: choice.name })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onChosen(result.value)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!saving}
      title={w.chooseTitle}
      description={w.chooseDescription}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('settings:calendars.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={saving || !remoteId}
            onClick={() => void save()}
          >
            {t('settings:calendars.save')}
          </Button>
        </>
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
        {choices === null && !error && <p>{w.loading}</p>}
        {choices && choices.length > 0 && (
          <Select
            label={w.picker}
            options={choices.map((choice) => ({ value: choice.remoteId, label: choice.name }))}
            value={remoteId}
            onChange={(event) => setRemoteId(event.target.value)}
          />
        )}
        {choices?.length === 0 && <p>{w.none}</p>}
        <p className="ostler-calendars__hint">{w.privacy}</p>
        {error && (
          <p className="ostler-calendars__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
