import { useCallback, useEffect, useState } from 'react'
import type { Contact } from '@shared/contacts'

/**
 * The contact list (N6.5), read in one call and again whenever any surface
 * changes it (the app, the automation API, an import). Null until loaded.
 * With `enabled` false it reads nothing, so a view whose tasks name no
 * contact (the filter bar) costs no call and no second render.
 */
export function useContacts(enabled = true): {
  contacts: Contact[] | null
  reload: () => Promise<void>
} {
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const reload = useCallback(async () => {
    if (!enabled) return
    if (typeof window.ostlerAPI.listContacts !== 'function') {
      setContacts([])
      return
    }
    const result = await window.ostlerAPI.listContacts()
    setContacts(result.ok ? result.value : [])
  }, [enabled])
  useEffect(() => {
    if (!enabled) return
    void reload()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'contacts') void reload()
    })
  }, [enabled, reload])
  return { contacts, reload }
}

/** Opens Call, Email or Open website for a stored contact; main builds the address. */
export async function openContact(
  contactId: string,
  how: { kind: 'call' | 'email' | 'website'; index?: number }
): Promise<string | null> {
  const result = await window.ostlerAPI.openContact(contactId, how)
  return result.ok ? null : result.error
}
