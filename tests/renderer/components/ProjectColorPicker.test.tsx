import { describe, expect, it } from 'vitest'
import { PROJECT_COLORS } from '@shared/project-colors'
import { projectColorName } from '@renderer/components/ProjectColorPicker'

describe('projectColorName', () => {
  it('names every colour of the one palette, which lives only in PROJECT_COLORS', () => {
    const names = PROJECT_COLORS.map((color) => projectColorName(color))
    expect(names).toEqual([
      'Blue',
      'Violet',
      'Pink',
      'Amber',
      'Emerald',
      'Red',
      'Cyan',
      'Orange',
      'Lime',
      'Indigo'
    ])
    expect(projectColorName(PROJECT_COLORS[0].toUpperCase())).toBe('Blue')
  })

  it('falls back to the colour itself for one outside the palette', () => {
    expect(projectColorName('#123456')).toBe('#123456')
  })
})
