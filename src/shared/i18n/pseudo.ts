/**
 * The pseudo-locale, `en-XA` (P11.1): English with accented letters, about 30%
 * longer, in brackets. It is for testing only, in development builds: text
 * that shows without the brackets is hard-coded, and a cut-off bracket is
 * text that does not fit.
 *
 * Placeholders (`{{name}}`), nested keys (`$t(…)`) and `<Trans>` tags (`<0>`,
 * `<strong>`) are kept as they are, so interpolated values (a task's title,
 * say) show unchanged inside the brackets.
 */

const ACCENTED: Record<string, string> = {
  a: 'à',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'î',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'û',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'À',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Î',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ö',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Û',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž'
}

/** The markers every pseudo-localised string starts and ends with. */
export const PSEUDO_OPEN = '['
export const PSEUDO_CLOSE = ']'

/** Placeholders, nesting and tags: copied, never accented. */
const PROTECTED = /(\{\{[^}]*\}\}|\$t\([^)]*\)|<\/?[A-Za-z0-9]+\s*\/?>)/

/** One English string as the pseudo-locale shows it. */
export function pseudoLocalize(value: string): string {
  let letters = 0
  const body = value
    .split(PROTECTED)
    .map((part, index) => {
      if (index % 2 === 1) return part
      letters += part.length
      return part.replace(/[A-Za-z]/g, (char) => ACCENTED[char] ?? char)
    })
    .join('')
  const padding = '~'.repeat(Math.ceil(letters * 0.3))
  return `${PSEUDO_OPEN}${body}${padding}${PSEUDO_CLOSE}`
}

type Tree = { [key: string]: string | Tree }

/** A namespace's strings, pseudo-localised; translator comments are dropped. */
export function pseudoLocalizeTree(tree: Tree): Tree {
  const out: Tree = {}
  for (const [key, value] of Object.entries(tree)) {
    if (key.endsWith('_comment')) continue
    out[key] = typeof value === 'string' ? pseudoLocalize(value) : pseudoLocalizeTree(value)
  }
  return out
}
