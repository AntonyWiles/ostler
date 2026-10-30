// Must be the first import of index.ts: the sync engine reads the global `Buffer` while its
// modules load (for example `change-file.ts`), so it has to exist before any of them run.
import { install } from 'react-native-quick-crypto'

install()
