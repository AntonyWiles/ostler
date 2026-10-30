import {
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions
} from 'electron'
import { t } from '@shared/i18n'
import { offScreen } from '../off-screen'

/** At most this many spelling suggestions, as in other Windows apps. */
const MAX_SUGGESTIONS = 5

type TextMenuParams = Pick<
  ContextMenuParams,
  'isEditable' | 'misspelledWord' | 'dictionarySuggestions' | 'editFlags'
>

export interface TextMenuActions {
  /** Puts `word` in place of the misspelled word under the pointer. */
  replace: (word: string) => void
  /** Adds the misspelled word to the spelling dictionary. */
  addToDictionary: (word: string) => void
}

/**
 * The menu a right-click in a text field shows: the spelling checker's
 * suggestions for a misspelled word and Add to dictionary, then Cut, Copy,
 * Paste and Select all. Nothing outside a text field: the page's own menus
 * (a card's, a row's) are the renderer's.
 */
export function textMenuTemplate(
  params: TextMenuParams,
  actions: TextMenuActions
): MenuItemConstructorOptions[] {
  if (!params.isEditable) return []
  const items: MenuItemConstructorOptions[] = []
  const word = params.misspelledWord
  if (word) {
    const suggestions = params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS)
    if (suggestions.length === 0)
      items.push({ label: t('desktop:textMenu.noSuggestions'), enabled: false })
    for (const suggestion of suggestions)
      items.push({ label: suggestion, click: () => actions.replace(suggestion) })
    items.push(
      { type: 'separator' },
      { label: t('desktop:textMenu.addToDictionary'), click: () => actions.addToDictionary(word) },
      { type: 'separator' }
    )
  }
  const flags = params.editFlags
  items.push(
    { role: 'cut', label: t('desktop:appMenu.edit.cut'), enabled: flags.canCut },
    { role: 'copy', label: t('desktop:appMenu.edit.copy'), enabled: flags.canCopy },
    { role: 'paste', label: t('desktop:appMenu.edit.paste'), enabled: flags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', label: t('desktop:appMenu.edit.selectAll'), enabled: flags.canSelectAll }
  )
  return items
}

/**
 * Shows `textMenuTemplate` on a right-click in one of `win`'s text fields.
 * Electron shows no menu of its own, so without this the spelling checker
 * underlined words but right-click offered nothing. An Ostler off screen
 * shows no menu (`offScreen`).
 */
export function attachTextMenu(win: BrowserWindow): void {
  const contents = win.webContents
  contents.on('context-menu', (_event, params) => {
    if (offScreen) return
    const template = textMenuTemplate(params, {
      replace: (word) => contents.replaceMisspelling(word),
      addToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word)
    })
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: win })
  })
}
