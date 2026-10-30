import { LEGACY_NAMES } from '@shared/legacy-names'

/**
 * The view settings each window remembers in localStorage were saved under
 * `nexus.*` keys before the product was renamed. They move to the same names
 * under `ostler.*` before anything reads them; a key already saved under the
 * new name wins. Imported first by every page (`main.tsx`).
 */
export function moveLegacyStorageKeys(storage: Storage): void {
  const legacy: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(LEGACY_NAMES.localStoragePrefix)) legacy.push(key)
  }
  for (const key of legacy) {
    const next = `ostler.${key.slice(LEGACY_NAMES.localStoragePrefix.length)}`
    const value = storage.getItem(key)
    if (value !== null && storage.getItem(next) === null) storage.setItem(next, value)
    storage.removeItem(key)
  }
}

try {
  const storage = (globalThis as { localStorage?: Storage }).localStorage
  if (storage) moveLegacyStorageKeys(storage)
} catch {
  // Storage unavailable: the views start from their defaults, as on a new install.
}
