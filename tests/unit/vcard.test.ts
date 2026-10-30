import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readVCards, VCARD_LIMITS, VCardError } from '../../src/shared/vcard'
import { PlanningService } from '../../electron/services/planning-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const utf8 = (text: string) => new TextEncoder().encode(text)
const latin1 = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)))

describe('reading vCards (N6.5)', () => {
  it('reads a vCard 3.0 card: FN, ORG, TITLE, typed TELs, EMAIL, URL, ADR and NOTE', () => {
    const { cards, skipped } = readVCards(
      utf8(
        [
          'BEGIN:VCARD',
          'VERSION:3.0',
          'N:Bloom;Rosa;;;',
          'FN:Rosa Bloom',
          'ORG:Bloom & Co;Weddings',
          'TITLE:Florist',
          'TEL;TYPE=CELL,VOICE:+44 7700 900123',
          'TEL;TYPE=WORK:020 7946 0018',
          'EMAIL;TYPE=INTERNET:rosa@bloom.example',
          'URL:https://bloom.example',
          'ADR;TYPE=WORK:;;1 High Street;Leeds;;LS1 1AA;UK',
          'NOTE:Prefers texts\\, mornings\\nNot Sundays',
          'PHOTO;ENCODING=b;TYPE=JPEG:' + 'A'.repeat(500),
          'X-CUSTOM:ignored',
          'END:VCARD'
        ].join('\r\n')
      )
    )
    expect(skipped).toBe(0)
    expect(cards).toEqual([
      {
        name: 'Rosa Bloom',
        organisation: 'Bloom & Co, Weddings',
        role: 'Florist',
        phones: [
          { label: 'Mobile', number: '+44 7700 900123' },
          { label: 'Work', number: '020 7946 0018' }
        ],
        emails: ['rosa@bloom.example'],
        website: 'https://bloom.example',
        address: '1 High Street, Leeds, LS1 1AA, UK',
        notes: 'Prefers texts, mornings\nNot Sundays'
      }
    ])
  })

  it('reads vCard 2.1: bare types, quoted-printable with soft breaks and a charset', () => {
    const card = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=ISO-8859-1:Müller;Jürgen',
      'TEL;CELL;VOICE:0170 1234567',
      'TEL;HOME:030 123',
      'EMAIL;INTERNET:juergen@example.de',
      'NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Caf=C3=A9 owner, =',
      'call after 10',
      'ORG;QUOTED-PRINTABLE:Gr=FC=DFe GmbH',
      'END:VCARD'
    ].join('\r\n')
    const { cards } = readVCards(latin1(card))
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      name: 'Jürgen Müller',
      phones: [
        { label: 'Mobile', number: '0170 1234567' },
        { label: 'Home', number: '030 123' }
      ],
      emails: ['juergen@example.de'],
      notes: 'Café owner, call after 10'
    })
    // Quoted-printable without a charset is read as UTF-8; bytes that are not
    // UTF-8 come out replaced, never as anything that could run.
    expect(cards[0].organisation).toMatch(/^Gr.*e GmbH$/)
  })

  it('reads vCard 4.0 with folded lines, tel: and mailto: values, and groups', () => {
    const { cards } = readVCards(
      utf8(
        [
          'BEGIN:VCARD',
          'VERSION:4.0',
          'FN:Adam Plu',
          ' mb',
          'item1.TEL;VALUE=uri;TYPE="voice,cell":tel:+1-555-555-0100',
          'EMAIL:mailto:adam@plumb.example',
          'NOTE:A very long note that was folded',
          '\t across two lines',
          'END:VCARD'
        ].join('\n')
      )
    )
    expect(cards).toEqual([
      expect.objectContaining({
        name: 'Adam Plumb',
        phones: [{ label: 'Mobile', number: '+1-555-555-0100' }],
        emails: ['adam@plumb.example'],
        notes: 'A very long note that was folded across two lines'
      })
    ])
  })

  it('reads several cards, uses N or ORG when there is no FN, and skips cards with neither', () => {
    const { cards, skipped } = readVCards(
      utf8(
        [
          'BEGIN:VCARD\nVERSION:3.0\nFN:One\nEND:VCARD',
          'BEGIN:VCARD\nVERSION:3.0\nN:Two;Second;;Dr;\nEND:VCARD',
          'BEGIN:VCARD\nVERSION:3.0\nORG:Three Ltd\nEND:VCARD',
          'BEGIN:VCARD\nVERSION:3.0\nTEL:123\nEND:VCARD'
        ].join('\n')
      )
    )
    expect(cards.map((card) => card.name)).toEqual(['One', 'Dr Second Two', 'Three Ltd'])
    expect(skipped).toBe(1)
  })

  it('stands up to hostile input', () => {
    expect(() => readVCards(utf8('hello'))).toThrow(VCardError)
    expect(() => readVCards(new Uint8Array(VCARD_LIMITS.bytes + 1))).toThrow(/too-large/)
    const long = 'x'.repeat(VCARD_LIMITS.lineLength + 10)
    const { cards } = readVCards(
      utf8(
        [
          'BEGIN:VCARD',
          `FN:${long}`,
          'FN:Short name',
          'EMAIL:not-an-email',
          'EMAIL:a@b.example?subject=x',
          'URL:javascript:alert(1)',
          `NOTE:${'n'.repeat(9000)}`,
          'TEL:' + '9'.repeat(100),
          'FN\u0000:control',
          'END:VCARD',
          'END:VCARD',
          'BEGIN:VCARD'
        ].join('\r\n')
      )
    )
    expect(cards).toHaveLength(1)
    expect(cards[0].name).toBe('Short name')
    expect(cards[0].emails).toEqual([])
    expect(cards[0].website).toBe('')
    expect(cards[0].notes.length).toBeLessThanOrEqual(5000)
    expect(cards[0].phones.every((phone) => phone.number.length <= 40)).toBe(true)
  })

  it('reads at most the card limit', () => {
    const many = Array.from(
      { length: VCARD_LIMITS.cards + 3 },
      (_v, i) => `BEGIN:VCARD\nFN:P${i}\nEND:VCARD`
    ).join('\n')
    const result = readVCards(utf8(many))
    expect(result.cards).toHaveLength(VCARD_LIMITS.cards)
    expect(result.tooManyCards).toBe(true)
    expect(result.skipped).toBe(3)
  })
})

describe('importing cards (N6.5)', () => {
  const tempDir = useTempDir('ostler-vcard-')
  let planning: PlanningService
  beforeEach(async () => {
    planning = new PlanningService(await createMigratedDatabase(tempDir()), () => [])
  })
  afterEach(() => {
    planning.close()
  })

  it('offers a card whose email matches as an update, and fills in what the contact lacks', () => {
    const rosa = planning.contacts.create({
      name: 'Rosa',
      emails: ['Rosa@Bloom.example'],
      phones: [{ label: 'Mobile', number: '07700 900123' }]
    })
    const { cards } = readVCards(
      utf8(
        [
          'BEGIN:VCARD',
          'FN:Rosa Bloom',
          'ORG:Bloom & Co',
          'EMAIL:rosa@bloom.example',
          'EMAIL:orders@bloom.example',
          'TEL;TYPE=CELL:07700900123',
          'TEL;TYPE=WORK:0113 496 0000',
          'END:VCARD',
          'BEGIN:VCARD',
          'FN:Adam Plumb',
          'END:VCARD'
        ].join('\n')
      )
    )
    const matches = planning.contacts.matchAllByEmail(cards.map((card) => card.emails))
    expect(matches.map((match) => match?.id ?? null)).toEqual([rosa.id, null])

    const { created, updated } = planning.contacts.importCards([
      { card: cards[0], updateId: rosa.id },
      { card: cards[1], updateId: null }
    ])
    expect(created.map((contact) => contact.name)).toEqual(['Adam Plumb'])
    expect(updated[0]).toMatchObject({
      name: 'Rosa',
      organisation: 'Bloom & Co',
      emails: ['Rosa@Bloom.example', 'orders@bloom.example'],
      phones: [
        { label: 'Mobile', number: '07700 900123' },
        { label: 'Work', number: '0113 496 0000' }
      ]
    })
    expect(planning.contacts.list()).toHaveLength(2)
  })
})
