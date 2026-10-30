import { describe, expect, it } from 'vitest'
import {
  parseTaskKey,
  parseTaskPrefix,
  prefixFromName,
  taskBranchName,
  taskKey
} from '../../src/shared/task-key'

/** Task IDs (N9.8a): prefixes from names, reading typed IDs, and Copy branch name. */
describe('task IDs', () => {
  describe('prefixFromName', () => {
    it('takes the first letters of up to three words, or three letters of one word', () => {
      expect(prefixFromName('Shop')).toBe('SHO')
      expect(prefixFromName('Online shop')).toBe('OS')
      expect(prefixFromName('Big online shop')).toBe('BOS')
      expect(prefixFromName('The big online shop')).toBe('TBO')
    })

    it('reads letters only, accents taken off', () => {
      expect(prefixFromName('Café über-alles')).toBe('CUA')
      expect(prefixFromName('2026 garden')).toBe('GAR')
      expect(prefixFromName('X')).toBe('TASK')
      expect(prefixFromName('42')).toBe('TASK')
    })

    it('is made unique among the prefixes taken by adding a letter', () => {
      expect(prefixFromName('Shop', ['SHO'])).toBe('SHOP')
      expect(prefixFromName('Shop', ['SHO', 'SHOP'])).toBe('SHOA')
      expect(prefixFromName('Online shop', ['OS'])).toBe('OSL')
      const taken: string[] = []
      for (let i = 0; i < 40; i++) taken.push(prefixFromName('Shop', taken))
      expect(new Set(taken).size).toBe(40)
      expect(taken.every((prefix) => /^[A-Z]{2,5}$/.test(prefix))).toBe(true)
    })
  })

  it('checks a typed prefix: two to five letters A to Z, made capital', () => {
    expect(parseTaskPrefix(' shop ')).toBe('SHOP')
    expect(parseTaskPrefix('AB')).toBe('AB')
    expect(parseTaskPrefix('A')).toBeNull()
    expect(parseTaskPrefix('TOOLONG')).toBeNull()
    expect(parseTaskPrefix('SH0P')).toBeNull()
    expect(parseTaskPrefix('ÉTÉ')).toBeNull()
    expect(parseTaskPrefix(12)).toBeNull()
  })

  it('makes and reads IDs', () => {
    expect(taskKey('SHOP', 12)).toBe('SHOP-12')
    expect(taskKey('SHOP', null)).toBeNull()
    expect(taskKey(null, 12)).toBeNull()
    for (const typed of ['SHOP-12', 'shop-12', 'shop 12', ' Shop12 '])
      expect(parseTaskKey(typed)).toEqual({ prefix: 'SHOP', number: 12 })
    expect(parseTaskKey('shop')).toBeNull()
    expect(parseTaskKey('fix the login')).toBeNull()
    expect(parseTaskKey('SHOP-0')).toBeNull()
  })

  describe('taskBranchName', () => {
    it('is the prefix in small letters, the number and the title as a slug', () => {
      expect(taskBranchName('SHOP', 12, 'Fix the login')).toBe('shop-12-fix-the-login')
    })

    it('takes accents off and leaves symbols out', () => {
      expect(taskBranchName('SHOP', 3, 'Crème brûlée: 2× faster!')).toBe(
        'shop-3-creme-brulee-2-faster'
      )
      expect(taskBranchName('SHOP', 4, '  --Ünïcode__ & spaces  ')).toBe('shop-4-unicode-spaces')
    })

    it('keeps a long title within 50 characters, cut at a word', () => {
      const name = taskBranchName(
        'SHOP',
        123,
        'Make the checkout page remember the address people used last time'
      )
      expect(name.length).toBeLessThanOrEqual(50)
      expect(name).toBe('shop-123-make-the-checkout-page-remember-the')
      expect(name.endsWith('-')).toBe(false)
      expect(taskBranchName('SHOP', 1, 'a'.repeat(80)).length).toBe(50)
    })

    it('is just the ID for an empty title or one with no letters', () => {
      expect(taskBranchName('SHOP', 7, '')).toBe('shop-7')
      expect(taskBranchName('SHOP', 7, '!!! ???')).toBe('shop-7')
    })
  })
})
