// The `uuid` package (used by migration 0006) has no random source on React Native; this
// gives it the one quick-crypto provides.
import { randomUUID } from 'react-native-quick-crypto'

export const v4 = (): string => randomUUID()
