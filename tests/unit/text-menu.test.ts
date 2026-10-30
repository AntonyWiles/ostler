import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Menu: { buildFromTemplate: vi.fn() } }))

const { textMenuTemplate } = await import('../../electron/app/desktop/text-menu')

const FLAGS = {
  canUndo: true,
  canRedo: true,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true,
  canEditRichly: false
}

const params = (overrides: Partial<Parameters<typeof textMenuTemplate>[0]> = {}) => ({
  isEditable: true,
  misspelledWord: '',
  dictionarySuggestions: [],
  editFlags: FLAGS,
  ...overrides
})

const labels = (items: ReturnType<typeof textMenuTemplate>) =>
  items.map((item) => (item.type === 'separator' ? '—' : item.label))

describe('the text field menu', () => {
  it('offers the spelling suggestions first, and replaces the word with the one chosen', () => {
    const replace = vi.fn()
    const addToDictionary = vi.fn()
    const items = textMenuTemplate(
      params({ misspelledWord: 'recieve', dictionarySuggestions: ['receive', 'relieve'] }),
      { replace, addToDictionary }
    )
    expect(labels(items)).toEqual([
      'receive',
      'relieve',
      '—',
      'Add to dictionary',
      '—',
      'Cut',
      'Copy',
      'Paste',
      '—',
      'Select all'
    ])
    ;(items[0].click as () => void)()
    expect(replace).toHaveBeenCalledWith('receive')
    ;(items[3].click as () => void)()
    expect(addToDictionary).toHaveBeenCalledWith('recieve')
  })

  it('says when there are no suggestions, and keeps at most five', () => {
    const actions = { replace: vi.fn(), addToDictionary: vi.fn() }
    const none = textMenuTemplate(params({ misspelledWord: 'qzx' }), actions)
    expect(none[0]).toMatchObject({ label: 'No spelling suggestions', enabled: false })
    const many = textMenuTemplate(
      params({ misspelledWord: 'teh', dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
      actions
    )
    expect(labels(many).slice(0, 6)).toEqual(['a', 'b', 'c', 'd', 'e', '—'])
  })

  it('offers only editing for a word spelled right, and nothing outside a text field', () => {
    const actions = { replace: vi.fn(), addToDictionary: vi.fn() }
    const items = textMenuTemplate(
      params({ editFlags: { ...FLAGS, canCut: false, canCopy: false } }),
      actions
    )
    expect(labels(items)).toEqual(['Cut', 'Copy', 'Paste', '—', 'Select all'])
    expect(items[0]).toMatchObject({ role: 'cut', enabled: false })
    expect(textMenuTemplate(params({ isEditable: false }), actions)).toEqual([])
  })
})
