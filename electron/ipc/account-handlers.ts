import {
  type AccountAppInput,
  type AccountCapability,
  type AccountProvider,
  type AddAccountCalendarInput,
  type CloudFileRead,
  type SetCalendarWriteTargetInput,
  type SetTaskListTargetInput,
  type ConnectAccountInput
} from '@shared/ostler-api'
import type { ConnectedAccountsService } from '../services/accounts/connected-accounts-service'
import { listAccountCalendars } from '../services/accounts/account-calendars'
import type { OutsideCalendarService } from '../services/outside-calendar-service'
import { readAccountContacts } from '../services/accounts/account-contacts'
import { cloudFileName } from '../services/accounts/account-files'
import type { TimeBlockMirror } from '../services/accounts/time-block-mirror'
import { listTaskLists, type TaskListMirror } from '../services/accounts/task-list-mirror'
import { cloudFileOf } from '@shared/cloud-file-link'
import { AccountCallError } from '../services/accounts/account-fetch'
import type { ContactsService } from '../services/contacts-service'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import { handleApi } from './handle-ipc'

/** A failed call to the provider as words the person can act on. */
async function readable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof AccountCallError) {
      throw new Refusal(t(`errors:accounts.failure.${error.reason}`))
    }
    throw error
  }
}

/**
 * Connected accounts (docs/plans/integrations/overview.md, phase 0): Settings ›
 * Connections › Accounts. Signing in happens in the system browser, started
 * from main; tokens and passwords stay in main. A CalDAV password comes in
 * once, to connect, and is never sent back.
 */
export function registerAccountHandlers(
  accounts: ConnectedAccountsService,
  {
    calendars,
    contacts,
    blockMirror,
    taskMirror
  }: {
    calendars: { service: OutsideCalendarService; changed(): void }
    /** Writing back (phase 6): where time blocks are copied. */
    blockMirror: TimeBlockMirror | null
    /** Writing back (phase 6): where my open tasks are copied. */
    taskMirror: TaskListMirror | null
    /** Contacts (phase 2): the cards are matched by email, then imported as from a `.vcf`. */
    contacts: () => ContactsService
  }
): void {
  handleApi('listAccounts', () => accounts.list())
  handleApi('listAccountProviders', () => accounts.providers())
  handleApi('connectAccount', (_event, input: ConnectAccountInput) => accounts.connect(input))
  handleApi('addAccountCapabilities', (_event, id: string, capabilities: AccountCapability[]) =>
    accounts.addCapabilities(id, Array.isArray(capabilities) ? capabilities : [])
  )
  handleApi('disconnectAccount', (_event, id: string) => accounts.disconnect(id))
  handleApi('setAccountApp', (_event, input: AccountAppInput) => accounts.setApp(input))
  handleApi('removeAccountApp', (_event, provider: AccountProvider) => accounts.removeApp(provider))

  // Calendars from accounts (phase 1): listed and read in main, added like a link.
  handleApi('listAccountCalendars', async (_event, accountId: string) => {
    const added = new Set(calendars.service.addedFromAccount(accountId))
    return (await readable(() => listAccountCalendars(accounts, accountId))).map((choice) => ({
      ...choice,
      added: added.has(choice.remoteId)
    }))
  })

  // Cloud file links (phase 3): the name a Library link's file has now. Each
  // account that picks files at that provider is tried until one can read it.
  handleApi('readCloudFile', async (_event, url: unknown): Promise<CloudFileRead | null> => {
    const link = typeof url === 'string' ? cloudFileOf(url) : null
    if (!link || typeof url !== 'string') return null
    const candidates = accounts
      .accountsWith('files.pick')
      .filter((account) => account.provider === link.provider)
    let failure: CloudFileRead['failure'] = 'noAccount'
    for (const account of candidates) {
      try {
        const file = await cloudFileName(accounts, account.id, url)
        if (file) return { service: link.service, name: file.name, failure: null }
        failure = 'server'
      } catch (error) {
        if (!(error instanceof AccountCallError)) throw error
        failure = error.reason
      }
    }
    return { service: link.service, name: null, failure }
  })

  // Time blocks into a calendar (phase 6).
  handleApi('getCalendarWriteTarget', () => blockMirror?.target() ?? null)
  handleApi('setCalendarWriteTarget', async (_event, input: SetCalendarWriteTargetInput | null) => {
    if (!blockMirror) return null
    if (input === null) await blockMirror.clearTarget()
    else await readable(() => blockMirror.setTarget(input))
    return blockMirror.target()
  })

  // My tasks into To Do or Google Tasks (phase 6).
  handleApi('listTaskLists', (_event, accountId: string) =>
    readable(() => listTaskLists(accounts, accountId))
  )
  handleApi('getTaskListTarget', () => taskMirror?.target() ?? null)
  handleApi('setTaskListTarget', async (_event, input: SetTaskListTargetInput | null) => {
    if (!taskMirror) return null
    if (input === null) await taskMirror.clearTarget()
    else await readable(() => taskMirror.setTarget(input))
    return taskMirror.target()
  })

  // Contacts from accounts (phase 2): read in main, previewed and imported like a `.vcf`.
  handleApi('readAccountContacts', async (_event, accountId: string) => {
    const account = accounts.get(accountId)
    if (!account.capabilities.includes('contacts.read')) {
      throw new Refusal(t('errors:accounts.notAllowed'))
    }
    const read = await readable(() =>
      readAccountContacts(accounts, accountId, {
        mobile: t('views:contacts.phoneTypes.mobile'),
        home: t('views:contacts.phoneTypes.home'),
        work: t('views:contacts.phoneTypes.work'),
        fax: t('views:contacts.phoneTypes.fax')
      })
    )
    const matches = contacts().matchAllByEmail(read.cards.map((card) => card.emails))
    return {
      fileName: `${t(`settings:accounts.provider.${account.provider}`)} · ${account.label}`,
      cards: read.cards.map((card, index) => ({ card, match: matches[index] })),
      skipped: read.skipped,
      tooManyCards: read.tooManyCards
    }
  })
  handleApi('addAccountCalendar', async (_event, input: AddAccountCalendarInput) => {
    const calendar = await calendars.service.addAccountCalendar(input)
    calendars.changed()
    return calendar
  })
}
