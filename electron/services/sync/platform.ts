/**
 * The one place the sync engine's core files get Node and Electron services from.
 * The phone replaces this module through a Metro alias (`./platform` resolves to its own file
 * that exports the same names from React Native libraries), so core files must import these
 * names from here and never from `node:*` or `../../safe-storage` directly. `npm run lint`
 * checks that (`scripts/check-sync-core.cjs`).
 */
import * as nodePath from 'node:path'

export {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  sign,
  verify
} from 'node:crypto'
export { gunzipSync, gzipSync } from 'node:zlib'
export { constants as bufferConstants } from 'node:buffer'
export const path = nodePath
export { openSecret, sealSecret } from '../../safe-storage'
export { openChangeContext } from '../change-history/context'
