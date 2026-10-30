import { describe, expect, it } from 'vitest'
import { LEGACY_NAMES } from '../../src/shared/legacy-names'
import { isMentionUrl, mentionLink, mentionPersonId, mentionsIn } from '../../src/shared/mentions'

const S = 'ostler'
const ANA = '0f8fad5b-d9cb-469f-a165-70867728950e'
const BEN = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

describe('mentions (prompt 14)', () => {
  it('makes a Markdown link that reads as @Name', () => {
    expect(mentionLink({ id: ANA, name: 'Ana' }, S)).toBe(`[@Ana](${S}://person/${ANA})`)
  })

  it('keeps brackets in a name from breaking the link', () => {
    const link = mentionLink({ id: ANA, name: 'Ana [boss] (CEO)' }, S)
    expect(link).toBe(`[@Ana boss CEO](${S}://person/${ANA})`)
    expect(mentionsIn(link, S)).toEqual([ANA])
  })

  it('lists each person once, in the order they first appear', () => {
    const ben = mentionLink({ id: BEN, name: 'Ben' }, S)
    const ana = mentionLink({ id: ANA, name: 'Ana' }, S)
    expect(mentionsIn(`${ben} and ${ana} and ${ben}`, S)).toEqual([BEN, ANA])
  })

  it('accepts the old scheme, and ignores other schemes, items and plain @text', () => {
    expect(mentionsIn(`[@Ana](${LEGACY_NAMES.urlScheme}://person/${ANA})`, S)).toEqual([ANA])
    expect(mentionsIn(`[@Ana](https://example.com/person/${ANA})`, S)).toEqual([])
    expect(mentionsIn(`[task](${S}://task/${ANA}/${BEN})`, S)).toEqual([])
    expect(mentionsIn('@Ana can you check this?', S)).toEqual([])
  })

  it('knows a mention URL from any other URL', () => {
    expect(isMentionUrl(`${S}://person/${ANA}`, S)).toBe(true)
    expect(mentionPersonId(`${S}://person/${ANA}`, S)).toBe(ANA)
    expect(isMentionUrl(`${S}://person/${ANA}/extra`, S)).toBe(false)
    expect(isMentionUrl(`${S}://person/${ANA}?x=1`, S)).toBe(false)
    expect(isMentionUrl(`${S}://inbox`, S)).toBe(false)
    expect(isMentionUrl('javascript:alert(1)', S)).toBe(false)
  })
})
