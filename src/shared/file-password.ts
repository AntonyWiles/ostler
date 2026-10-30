/**
 * Passwords for protected project files (N45). Export takes any password of
 * at least `MIN_FILE_PASSWORD_LENGTH` characters; the strength is a hint,
 * never a rule.
 */

export const MIN_FILE_PASSWORD_LENGTH = 8

export type PasswordStrength = 'tooShort' | 'weak' | 'fair' | 'strong'

/** A rough guess from length and the kinds of character used. */
export function passwordStrength(password: string): PasswordStrength {
  const length = [...password].length
  if (length < MIN_FILE_PASSWORD_LENGTH) return 'tooShort'
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((kind) =>
    kind.test(password)
  ).length
  const score = (length >= 12 ? 1 : 0) + (length >= 16 ? 1 : 0) + (kinds >= 3 ? 1 : 0)
  if (score >= 2) return 'strong'
  if (score === 1 || kinds >= 2) return 'fair'
  return 'weak'
}
