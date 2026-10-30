import { describe, expect, it, vi } from 'vitest'
import { readAccountContacts } from '../../electron/services/accounts/account-contacts'

const words = { mobile: 'Mobile', home: 'Home', work: 'Work', fax: 'Fax' }

describe('contacts from connected accounts (integrations phase 2)', () => {
  it('reads Google contacts page by page and leaves out ones with no name or email', async () => {
    const callJson = vi
      .fn()
      .mockResolvedValueOnce({
        connections: [
          {
            names: [{ displayName: 'Rosa Bloom' }],
            emailAddresses: [{ value: 'rosa@bloom.example' }, { value: 'ROSA@bloom.example' }],
            phoneNumbers: [{ value: '+64 21 555', type: 'mobile' }],
            organizations: [{ name: 'Bloom Ltd', title: 'Florist' }]
          },
          { phoneNumbers: [{ value: '123' }] }
        ],
        nextPageToken: 'p2'
      })
      .mockResolvedValueOnce({ connections: [{ names: [{ displayName: 'Adam' }] }] })
    const accounts = {
      get: () => ({ provider: 'google' as const }),
      call: vi.fn(),
      callJson,
      serverOf: () => null
    }
    const read = await readAccountContacts(accounts as never, 'a1', words)
    expect(String(callJson.mock.calls[1][1])).toContain('pageToken=p2')
    expect(read.skipped).toBe(1)
    expect(read.cards).toEqual([
      expect.objectContaining({
        name: 'Rosa Bloom',
        organisation: 'Bloom Ltd',
        role: 'Florist',
        emails: ['rosa@bloom.example'],
        phones: [{ number: '+64 21 555', label: 'Mobile' }]
      }),
      expect.objectContaining({ name: 'Adam', emails: [] })
    ])
  })

  it('reads Microsoft contacts with their phones and address', async () => {
    const accounts = {
      get: () => ({ provider: 'microsoft' as const }),
      call: vi.fn(),
      callJson: vi.fn(async () => ({
        value: [
          {
            displayName: 'Mo Patel',
            emailAddresses: [{ address: 'mo@work.example' }],
            mobilePhone: '021 1',
            businessPhones: ['09 2', '021 1'],
            businessAddress: { street: '1 Queen St', city: 'Auckland' }
          }
        ]
      })),
      serverOf: () => null
    }
    const read = await readAccountContacts(accounts as never, 'a1', words)
    expect(read.cards[0]).toMatchObject({
      name: 'Mo Patel',
      emails: ['mo@work.example'],
      phones: [
        { number: '021 1', label: 'Mobile' },
        { number: '09 2', label: 'Work' }
      ],
      address: '1 Queen St, Auckland'
    })
  })

  it('reads CardDAV address books through the vCard reader', async () => {
    const xml = (body: string) => ({ status: 207, headers: {}, text: body })
    const multistatus = (responses: string) =>
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/">${responses}</d:multistatus>`
    const call = vi.fn(
      async (_id: string, url: string, init: { method?: string; body?: string }) => {
        const body = init.body ?? ''
        if (body.includes('current-user-principal'))
          return xml(
            multistatus(
              '<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/p/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>'
            )
          )
        if (body.includes('addressbook-home-set'))
          return xml(
            multistatus(
              '<d:response><d:href>/p/</d:href><d:propstat><d:prop><card:addressbook-home-set><d:href>/books/</d:href></card:addressbook-home-set></d:prop></d:propstat></d:response>'
            )
          )
        if (body.includes('addressbook-query'))
          return xml(
            multistatus(
              '<d:response><d:href>/books/a/1.vcf</d:href><d:propstat><d:prop><d:getetag>"1"</d:getetag><card:address-data>BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ann Card\r\nEMAIL:ann@card.example\r\nEND:VCARD</card:address-data></d:prop></d:propstat></d:response>'
            )
          )
        return xml(
          multistatus(
            '<d:response><d:href>/books/a/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>Contacts</d:displayname></d:prop></d:propstat></d:response>'
          )
        )
      }
    )
    const accounts = {
      get: () => ({ provider: 'caldav' as const }),
      call,
      callJson: vi.fn(),
      serverOf: () => 'https://dav.example.com/'
    }
    const read = await readAccountContacts(accounts as never, 'a1', words)
    expect(read.cards).toEqual([
      expect.objectContaining({ name: 'Ann Card', emails: ['ann@card.example'] })
    ])
  })
})
