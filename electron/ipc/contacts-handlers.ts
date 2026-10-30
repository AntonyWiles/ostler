import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { WatchedProject } from '@shared/ostler-api'
import { mailtoHref, telHref, websiteHref } from '@shared/contacts'
import { readVCards, VCARD_LIMITS, VCardError } from '@shared/vcard'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { PlanningService } from '../services/planning-service'
import { openContactAddress, openExternalUrl } from '../app/security'
import { handleApi } from './handle-ipc'

/**
 * Contacts (N6.5). The list is global, like people, so no project is
 * resolved for it; a task's contacts need its project, and the task must be
 * in it. Every read and write goes through `planningService.contacts`, the
 * service the automation API uses. Call, Email and Open website build their
 * address here from the stored contact, never from what the renderer sends.
 */
export function registerContactsHandlers({
  planningService,
  getProject,
  getMainWindow,
  notifyContactsChanged
}: {
  planningService: PlanningService
  getProject(projectId: string): WatchedProject
  getMainWindow(): BrowserWindow | null
  /** Pushes ON_PROJECT_STATE_CHANGE with field 'contacts'. */
  notifyContactsChanged(): void
}): void {
  const contacts = planningService.contacts
  /** The task, checked to be in a project Ostler knows. */
  const task = (projectId: string, workItemId: string) => {
    const project = getProject(projectId)
    const item = planningService.getWorkItem(workItemId)
    if (item.projectId !== project.id) throw new Refusal(t('errors:contacts.taskNotInProject'))
    return item.id
  }
  const changing =
    <TArgs extends unknown[], T>(handler: (...args: TArgs) => T) =>
    (_event: unknown, ...args: TArgs): T => {
      const value = handler(...args)
      notifyContactsChanged()
      return value
    }

  handleApi('listContacts', (_event, query?: unknown) =>
    contacts.list(typeof query === 'string' ? query : '')
  )
  handleApi(
    'createContact',
    changing((input: unknown) => contacts.create(input))
  )
  handleApi(
    'updateContact',
    changing((contactId: string, input: unknown) => contacts.update(contactId, input))
  )
  handleApi(
    'deleteContact',
    changing((contactId: string) => contacts.delete(contactId))
  )
  handleApi(
    'restoreContact',
    changing((deleted: unknown) => contacts.restore(deleted))
  )
  handleApi('contactTasks', (_event, contactId: string) => contacts.tasksOf(contactId))
  handleApi('taskContacts', (_event, projectId: string, workItemId: string) =>
    contacts.forTask(task(projectId, workItemId))
  )
  handleApi('projectTaskContacts', (_event, projectId: string) =>
    contacts.marksForProject(getProject(projectId).id)
  )
  handleApi(
    'linkTaskContact',
    (_event, projectId: string, workItemId: string, contactId: unknown, role: unknown) =>
      contacts.link(task(projectId, workItemId), contactId, role)
  )
  handleApi('unlinkTaskContact', (_event, projectId: string, workItemId: string, linkId: string) =>
    contacts.unlink(task(projectId, workItemId), linkId)
  )
  handleApi('relinkTaskContact', (_event, projectId: string, workItemId: string, link: unknown) =>
    contacts.relink(task(projectId, workItemId), link)
  )
  handleApi('openContact', async (_event, contactId: string, how: unknown) => {
    const contact = contacts.get(contactId)
    const { kind, index = 0 } = (how ?? {}) as { kind?: unknown; index?: unknown }
    const at = typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : -1
    if (kind === 'website') {
      const url = websiteHref(contact.website)
      if (!url) throw new Refusal(t('errors:contacts.noWebsite'))
      return openExternalUrl(url)
    }
    if (kind === 'call') {
      const phone = contact.phones[at]
      const url = phone ? telHref(phone.number) : null
      if (!url) throw new Refusal(t('errors:contacts.noPhone'))
      return openContactAddress(url)
    }
    if (kind === 'email') {
      const email = contact.emails[at]
      const url = email ? mailtoHref(email) : null
      if (!url) throw new Refusal(t('errors:contacts.noEmail'))
      return openContactAddress(url)
    }
    throw new Refusal(t('errors:contacts.openInvalid'))
  })
  handleApi('readVCardFile', async () => {
    const window = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: t('errors:contacts.importTitle'),
      properties: ['openFile'],
      filters: [
        { name: t('errors:contacts.vcardFiles'), extensions: ['vcf', 'vcard'] },
        { name: t('errors:importHandlers.allFiles'), extensions: ['*'] }
      ]
    }
    const choice = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const file = choice.canceled ? undefined : choice.filePaths[0]
    if (!file) return null
    if (fs.statSync(file).size > VCARD_LIMITS.bytes)
      throw new Refusal(t('errors:contacts.vcardTooLarge'))
    let result
    try {
      result = readVCards(new Uint8Array(fs.readFileSync(file)), {
        mobile: t('views:contacts.phoneTypes.mobile'),
        home: t('views:contacts.phoneTypes.home'),
        work: t('views:contacts.phoneTypes.work'),
        fax: t('views:contacts.phoneTypes.fax')
      })
    } catch (error) {
      if (error instanceof VCardError)
        throw new Refusal(
          error.message === 'too-large'
            ? t('errors:contacts.vcardTooLarge')
            : t('errors:contacts.vcardNoCards')
        )
      throw error
    }
    const matches = contacts.matchAllByEmail(result.cards.map((card) => card.emails))
    return {
      fileName: path.basename(file),
      cards: result.cards.map((card, index) => ({ card, match: matches[index] })),
      skipped: result.skipped,
      tooManyCards: result.tooManyCards
    }
  })
  handleApi(
    'importContacts',
    changing((choices: unknown) => contacts.importCards(choices))
  )
}
