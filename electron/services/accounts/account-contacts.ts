/**
 * Contacts from connected accounts (docs/plans/integrations/overview.md, phase 2):
 * Google contacts through the People API, Microsoft 365 and Outlook.com
 * contacts through Graph, and CardDAV address books (iCloud included). One
 * way only: the cards come back as `VCardContact`s for the same preview and
 * import as a `.vcf` file, so matching by email and every rule stay in
 * `ContactsService`. Nothing is ever written to the account.
 */
import type { ContactPhone } from '@shared/contacts'
import {
  readVCards,
  VCARD_LIMITS,
  VCardError,
  type VCardContact,
  type VCardWords
} from '@shared/vcard'
import type { ConnectedAccountsService } from './connected-accounts-service'
import { addressBookCards, listAddressBooks } from './dav'
import { davSend } from './account-calendars'

const MAX_PAGES = 20

type Accounts = Pick<ConnectedAccountsService, 'get' | 'call' | 'callJson' | 'serverOf'>

export interface AccountContactsRead {
  cards: VCardContact[]
  /** Cards left out: no name and no email, or past the card limit. */
  skipped: number
  tooManyCards: boolean
}

/** Every contact the account holds, as cards to preview and import. */
export async function readAccountContacts(
  accounts: Accounts,
  accountId: string,
  words: VCardWords
): Promise<AccountContactsRead> {
  const provider = accounts.get(accountId).provider
  const cards =
    provider === 'google'
      ? await googleContacts(accounts, accountId, words)
      : provider === 'microsoft'
        ? await graphContacts(accounts, accountId, words)
        : provider === 'caldav'
          ? await davContacts(accounts, accountId, words)
          : { cards: [], skipped: 0, tooManyCards: false }
  return cards
}

/** Keeps cards with a name or an email, up to the card limit. */
function kept(all: VCardContact[], skippedBefore = 0): AccountContactsRead {
  const usable = all.filter((card) => card.name.trim() || card.emails.length > 0)
  return {
    cards: usable.slice(0, VCARD_LIMITS.cards),
    skipped:
      skippedBefore +
      (all.length - usable.length) +
      Math.max(0, usable.length - VCARD_LIMITS.cards),
    tooManyCards: usable.length > VCARD_LIMITS.cards
  }
}

function card(fields: Partial<VCardContact>): VCardContact {
  return {
    name: '',
    organisation: '',
    role: '',
    phones: [],
    emails: [],
    website: '',
    address: '',
    notes: '',
    ...fields
  }
}

function unique(values: (string | undefined | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue
    seen.add(trimmed.toLowerCase())
    out.push(trimmed)
  }
  return out
}

function phoneType(type: string | undefined, words: VCardWords): string {
  const lower = (type ?? '').toLowerCase()
  if (lower.includes('mobile') || lower.includes('cell')) return words.mobile
  if (lower.includes('fax')) return words.fax
  if (lower.includes('home')) return words.home
  if (lower.includes('work') || lower.includes('business')) return words.work
  return ''
}

// ─── Google People API ──────────────────────────────────────────────────

interface GooglePerson {
  names?: { displayName?: string }[]
  emailAddresses?: { value?: string }[]
  phoneNumbers?: { value?: string; type?: string }[]
  organizations?: { name?: string; title?: string }[]
  urls?: { value?: string }[]
  addresses?: { formattedValue?: string }[]
  biographies?: { value?: string }[]
}

async function googleContacts(
  accounts: Accounts,
  accountId: string,
  words: VCardWords
): Promise<AccountContactsRead> {
  const all: VCardContact[] = []
  let pageToken: string | null = null
  for (let page = 0; page < MAX_PAGES && all.length <= VCARD_LIMITS.cards; page++) {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections')
    url.searchParams.set(
      'personFields',
      'names,emailAddresses,phoneNumbers,organizations,urls,addresses,biographies'
    )
    url.searchParams.set('pageSize', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const answer = await accounts.callJson<{
      connections?: GooglePerson[]
      nextPageToken?: string
    }>(accountId, url.toString())
    for (const person of answer.connections ?? []) {
      all.push(
        card({
          name: person.names?.[0]?.displayName ?? '',
          organisation: person.organizations?.[0]?.name ?? '',
          role: person.organizations?.[0]?.title ?? '',
          emails: unique((person.emailAddresses ?? []).map((entry) => entry.value)),
          phones: phones(
            (person.phoneNumbers ?? []).map((entry) => ({
              number: entry.value,
              type: entry.type
            })),
            words
          ),
          website: person.urls?.[0]?.value ?? '',
          address: person.addresses?.[0]?.formattedValue ?? '',
          notes: person.biographies?.[0]?.value ?? ''
        })
      )
    }
    pageToken = answer.nextPageToken ?? null
    if (!pageToken) break
  }
  return kept(all)
}

// ─── Microsoft Graph ────────────────────────────────────────────────────

interface GraphAddress {
  street?: string
  city?: string
  state?: string
  postalCode?: string
  countryOrRegion?: string
}

interface GraphContact {
  displayName?: string
  companyName?: string
  jobTitle?: string
  emailAddresses?: { address?: string }[]
  mobilePhone?: string | null
  businessPhones?: string[]
  homePhones?: string[]
  businessHomePage?: string | null
  personalNotes?: string | null
  businessAddress?: GraphAddress
  homeAddress?: GraphAddress
}

async function graphContacts(
  accounts: Accounts,
  accountId: string,
  words: VCardWords
): Promise<AccountContactsRead> {
  const all: VCardContact[] = []
  const first = new URL('https://graph.microsoft.com/v1.0/me/contacts')
  first.searchParams.set('$top', '500')
  first.searchParams.set(
    '$select',
    'displayName,companyName,jobTitle,emailAddresses,mobilePhone,businessPhones,homePhones,businessHomePage,personalNotes,businessAddress,homeAddress'
  )
  let next: string | null = first.toString()
  for (let page = 0; next && page < MAX_PAGES && all.length <= VCARD_LIMITS.cards; page++) {
    const answer: { value?: GraphContact[]; '@odata.nextLink'?: string } = await accounts.callJson(
      accountId,
      next
    )
    for (const contact of answer.value ?? []) {
      all.push(
        card({
          name: contact.displayName ?? '',
          organisation: contact.companyName ?? '',
          role: contact.jobTitle ?? '',
          emails: unique((contact.emailAddresses ?? []).map((entry) => entry.address)),
          phones: phones(
            [
              { number: contact.mobilePhone ?? undefined, type: 'mobile' },
              ...(contact.businessPhones ?? []).map((number) => ({ number, type: 'work' })),
              ...(contact.homePhones ?? []).map((number) => ({ number, type: 'home' }))
            ],
            words
          ),
          website: contact.businessHomePage ?? '',
          address: graphAddress(contact.businessAddress) || graphAddress(contact.homeAddress),
          notes: contact.personalNotes ?? ''
        })
      )
    }
    next = answer['@odata.nextLink'] ?? null
  }
  return kept(all)
}

function graphAddress(address: GraphAddress | undefined): string {
  if (!address) return ''
  return [address.street, address.city, address.state, address.postalCode, address.countryOrRegion]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ')
}

function phones(entries: { number?: string; type?: string }[], words: VCardWords): ContactPhone[] {
  const seen = new Set<string>()
  const out: ContactPhone[] = []
  for (const entry of entries) {
    const number = entry.number?.trim()
    if (!number || seen.has(number)) continue
    seen.add(number)
    out.push({ number, label: phoneType(entry.type, words) })
  }
  return out
}

// ─── CardDAV ────────────────────────────────────────────────────────────

async function davContacts(
  accounts: Accounts,
  accountId: string,
  words: VCardWords
): Promise<AccountContactsRead> {
  const server = accounts.serverOf(accountId)
  if (!server) return { cards: [], skipped: 0, tooManyCards: false }
  const send = davSend(accounts, accountId)
  const texts: string[] = []
  let bytes = 0
  for (const book of await listAddressBooks(send, server)) {
    for (const resource of await addressBookCards(send, book.url)) {
      bytes += Buffer.byteLength(resource.data) + 2
      if (bytes > VCARD_LIMITS.bytes) break
      texts.push(resource.data)
    }
  }
  if (texts.length === 0) return { cards: [], skipped: 0, tooManyCards: false }
  try {
    const result = readVCards(new TextEncoder().encode(texts.join('\r\n')), words)
    return kept(result.cards, result.skipped)
  } catch (error) {
    // No card the reader could use: nothing to import.
    if (error instanceof VCardError)
      return { cards: [], skipped: texts.length, tooManyCards: false }
    throw error
  }
}
