/**
 * The part of `node:path` the sync engine uses (Drive places and relative file names), with
 * forward slashes only. `resolve` has no working directory on a phone, so it treats the
 * root as the base.
 */
function normalizeParts(input: string, absolute: boolean): string[] {
  const out: string[] = []
  for (const part of input.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!absolute) out.push('..')
    } else out.push(part)
  }
  return out
}

function normalize(input: string): string {
  if (input === '') return '.'
  const absolute = input.startsWith('/')
  const body = normalizeParts(input, absolute).join('/')
  const trailing = input.endsWith('/') && body !== '' ? '/' : ''
  if (absolute) return `/${body}${trailing}`
  return `${body === '' ? '.' : body}${trailing}`
}

function join(...parts: string[]): string {
  const joined = parts.filter((part) => part !== '').join('/')
  return joined === '' ? '.' : normalize(joined)
}

function dirname(input: string): string {
  const trimmed = input.length > 1 ? input.replace(/\/+$/, '') : input
  const slash = trimmed.lastIndexOf('/')
  if (slash === -1) return '.'
  if (slash === 0) return '/'
  return trimmed.slice(0, slash)
}

function basename(input: string, extension?: string): string {
  const trimmed = input.replace(/\/+$/, '')
  const name = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return extension && name.endsWith(extension) && name !== extension
    ? name.slice(0, -extension.length)
    : name
}

function isAbsolute(input: string): boolean {
  return input.startsWith('/')
}

function resolve(...parts: string[]): string {
  let current = ''
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === '') continue
    current = current === '' ? parts[i] : `${parts[i]}/${current}`
    if (isAbsolute(parts[i])) break
  }
  const body = normalizeParts(current, true).join('/')
  return `/${body}`
}

function relative(from: string, to: string): string {
  const a = normalizeParts(resolve(from), true)
  const b = normalizeParts(resolve(to), true)
  let shared = 0
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++
  return [...a.slice(shared).map(() => '..'), ...b.slice(shared)].join('/')
}

export const posixPath = { sep: '/', join, dirname, basename, isAbsolute, resolve, relative }
