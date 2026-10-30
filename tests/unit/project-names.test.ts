import { describe, expect, it } from 'vitest'
import { freeProjectName, isProjectNameTaken } from '../../src/shared/project-names'

describe('a free project name', () => {
  it('keeps a name nobody has', () => {
    expect(freeProjectName('Pomodoro Desk', ['Website'])).toBe('Pomodoro Desk')
    expect(freeProjectName('  Pomodoro Desk  ', [])).toBe('Pomodoro Desk')
  })

  it('numbers a name in use: (2), then (3)', () => {
    expect(freeProjectName('Pomodoro Desk', ['Pomodoro Desk'])).toBe('Pomodoro Desk (2)')
    expect(freeProjectName('Pomodoro Desk', ['Pomodoro Desk', 'Pomodoro Desk (2)'])).toBe(
      'Pomodoro Desk (3)'
    )
  })

  it('compares trimmed and case-insensitively', () => {
    expect(freeProjectName('pomodoro desk', [' Pomodoro Desk '])).toBe('pomodoro desk (2)')
    expect(freeProjectName('Pomodoro Desk', ['POMODORO DESK', 'pomodoro desk (2)'])).toBe(
      'Pomodoro Desk (3)'
    )
  })

  it('counts on from a name that is already numbered', () => {
    expect(freeProjectName('Desk (2)', ['Desk', 'Desk (2)'])).toBe('Desk (3)')
  })

  it('stays within 80 characters', () => {
    const long = 'x'.repeat(80)
    expect(freeProjectName(long, [long])).toBe(`${'x'.repeat(76)} (2)`)
  })

  it('says whether a typed name is in use, leaving out the project being renamed', () => {
    const projects = [
      { id: 'a', name: 'Website' },
      { id: 'b', name: 'Garden' }
    ]
    expect(isProjectNameTaken(' website ', projects)).toBe(true)
    expect(isProjectNameTaken('Website', projects, 'a')).toBe(false)
    expect(isProjectNameTaken('Kitchen', projects)).toBe(false)
    expect(isProjectNameTaken('   ', projects)).toBe(false)
  })
})
