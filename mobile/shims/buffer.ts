// node:buffer for the sync engine: one Buffer class plus the `constants` export, which the
// `buffer` package does not have (`envelope.ts` reads `constants.MAX_LENGTH`).
import { Buffer, kMaxLength } from 'buffer'

export { Buffer }
export const constants = { MAX_LENGTH: kMaxLength, MAX_STRING_LENGTH: (1 << 29) - 24 }
