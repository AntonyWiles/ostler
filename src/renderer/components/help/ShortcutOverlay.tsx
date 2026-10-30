import { useMemo, useState } from 'react'
import { t } from '@shared/i18n'
import {
  shortcutGroupLabel,
  shortcutGroups,
  shortcutLabel,
  type ShortcutDefinition
} from '../../navigation/shortcuts'
import { Dialog, Kbd, SearchField } from '../../ui'
import { shortcutText } from '../../ui/Kbd'
import './ShortcutOverlay.css'

/**
 * The `?` overlay (P8.1): every shortcut in the shortcut table, grouped by
 * where it works, with a search box. It reads `shortcuts.ts` and nothing
 * else, so it cannot disagree with the handlers or the tooltips.
 */
export function ShortcutOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const matches = (entry: ShortcutDefinition) => {
      const text = `${shortcutLabel(entry.id)} ${shortcutText(entry.keys)}`.toLowerCase()
      return words.every((word) => text.includes(word))
    }
    return shortcutGroups()
      .map((group) => ({ ...group, shortcuts: group.shortcuts.filter(matches) }))
      .filter((group) => group.shortcuts.length > 0)
  }, [query])

  return (
    <Dialog
      open={open}
      onClose={() => {
        setQuery('')
        onClose()
      }}
      title={t('help:shortcutOverlay.title')}
      description={t('help:shortcutOverlay.description')}
      size="lg"
      className="ostler-shortcut-overlay"
    >
      <SearchField
        label={t('help:shortcutOverlay.search')}
        placeholder={t('help:shortcutOverlay.search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        data-autofocus
      />
      {groups.length === 0 ? (
        <p className="ostler-shortcut-overlay__empty" role="status">
          {t('help:shortcutOverlay.noMatch', { query: query.trim() })}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.id} className="ostler-shortcut-overlay__group">
            <h3>{shortcutGroupLabel(group.id)}</h3>
            <dl>
              {group.shortcuts.map((entry) => (
                <div key={entry.id} className="ostler-shortcut-overlay__row">
                  <dt>{shortcutLabel(entry.id)}</dt>
                  <dd>
                    <ShortcutKeys keys={entry.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      )}
    </Dialog>
  )
}

/** Keys as keycaps: "G then H" and "Alt+Shift+Left or Right" read as words between the caps. */
export function ShortcutKeys({ keys }: { keys: string }) {
  // The joining words are written in English in the table; shown translated.
  const parts = keys.split(/ (then|or) /)
  return (
    <span className="ostler-shortcut-keys">
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="ostler-shortcut-keys__word">
            {t(`common:keys.${part}`)}
          </span>
        ) : (
          <Kbd key={index} shortcut={part} />
        )
      )}
    </span>
  )
}
