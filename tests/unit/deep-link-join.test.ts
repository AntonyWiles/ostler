import { describe, expect, it } from 'vitest'
import {
  findInvite,
  INVITE_PREFIX,
  joinLinkFor,
  MAX_INVITE_LENGTH,
  parseJoinLink
} from '../../src/shared/deep-link'
import { t } from '../../src/shared/i18n'

const SCHEME = 'ostler'
const PAYLOAD = 'eyJzaGFyZUlkIjoiYWJjIn0_-AB'
const INVITE = `${INVITE_PREFIX}${PAYLOAD}`

describe('parseJoinLink', () => {
  it('gives back the invite for a join link', () => {
    expect(parseJoinLink(`ostler://join/${PAYLOAD}`, SCHEME)).toEqual({ ok: true, invite: INVITE })
  })

  it('accepts a trailing slash, which Windows may add', () => {
    expect(parseJoinLink(`ostler://join/${PAYLOAD}/`, SCHEME)).toEqual({ ok: true, invite: INVITE })
  })

  it('accepts a scheme in any case', () => {
    expect(parseJoinLink(`OSTLER://join/${PAYLOAD}`, SCHEME).ok).toBe(true)
  })

  it('accepts a payload of 4096 characters and refuses 4097', () => {
    const longest = 'a'.repeat(4096)
    expect(parseJoinLink(`ostler://join/${longest}`, SCHEME)).toEqual({
      ok: true,
      invite: INVITE_PREFIX + longest
    })
    expect(parseJoinLink(`ostler://join/${'a'.repeat(4097)}`, SCHEME)).toEqual({
      ok: false,
      reason: 'too long'
    })
  })

  it('refuses an empty payload', () => {
    expect(parseJoinLink(`ostler://join/`, SCHEME)).toEqual({ ok: false, reason: 'empty' })
  })

  it('refuses characters outside base64url', () => {
    for (const bad of ['abc+def', 'abc=', 'ab.cd', 'ab%20cd', 'ab\\cd']) {
      expect(parseJoinLink(`ostler://join/${bad}`, SCHEME).ok).toBe(false)
    }
  })

  it('refuses a query or a fragment', () => {
    expect(parseJoinLink(`ostler://join/${PAYLOAD}?x=1`, SCHEME)).toEqual({
      ok: false,
      reason: 'unexpected characters'
    })
    expect(parseJoinLink(`ostler://join/${PAYLOAD}#x`, SCHEME).ok).toBe(false)
  })

  it('refuses another scheme', () => {
    expect(parseJoinLink(`other://join/${PAYLOAD}`, SCHEME)).toEqual({
      ok: false,
      reason: 'another scheme'
    })
  })

  it('refuses a link that is not a join link', () => {
    expect(parseJoinLink('ostler://inbox', SCHEME)).toEqual({
      ok: false,
      reason: 'not a join link'
    })
    expect(parseJoinLink(`ostler://joins/${PAYLOAD}`, SCHEME).ok).toBe(false)
  })

  it('refuses something that is not text', () => {
    expect(parseJoinLink(42, SCHEME)).toEqual({ ok: false, reason: 'not text' })
  })

  it('is the inverse of joinLinkFor', () => {
    expect(parseJoinLink(joinLinkFor(INVITE, SCHEME), SCHEME)).toEqual({ ok: true, invite: INVITE })
    expect(joinLinkFor(INVITE, SCHEME)).toBe(`ostler://join/${PAYLOAD}`)
  })
})

describe('findInvite', () => {
  // The message Ostler copies for a person to send: steps, then the join link.
  const messageWith = (invite: string) =>
    t('projects:projectSharing.inviteMessage', {
      project: 'Make Ostler Public',
      folderStep: 'Open the folder.',
      link: joinLinkFor(invite, SCHEME)
    })

  it('finds the invite in the invite message Ostler copies', () => {
    const message = messageWith(INVITE)
    expect(message).not.toMatch(/^ostler-invite/)
    expect(findInvite(message, SCHEME)).toBe(INVITE)
  })

  it('finds it in a message Ostler copied before, with the link and then the invite', () => {
    const before = `Join "Make Ostler Public" in Ostler.\n\n1. Open the Google Drive folder I shared with you.\n2. Click this link: ${joinLinkFor(INVITE, SCHEME)}\n   Or paste this invite: ${INVITE}`
    expect(findInvite(before, SCHEME)).toBe(INVITE)
  })

  it('finds it in a message past the invite limit, when the invite is long', () => {
    const long = `${INVITE_PREFIX}${'a'.repeat(MAX_INVITE_LENGTH)}`
    const text = messageWith(long)
    expect(text.length).toBeGreaterThan(MAX_INVITE_LENGTH)
    expect(findInvite(text, SCHEME)).toBe(long)
  })

  it('takes the invite on its own, with spaces round it', () => {
    expect(findInvite(`  ${INVITE}\n`, SCHEME)).toBe(INVITE)
  })

  it('takes just the join link', () => {
    expect(findInvite(`Click this: ostler://join/${PAYLOAD}`, SCHEME)).toBe(INVITE)
  })

  it('finds nothing in text without an invite', () => {
    expect(findInvite('Join my project in Ostler', SCHEME)).toBeNull()
    expect(findInvite(42, SCHEME)).toBeNull()
  })
})
