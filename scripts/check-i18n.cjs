/*
 * Keeps the interface translatable (P11.1, docs/translating.md). `npm run lint`
 * runs it and fails when:
 *   - code uses a key that English (src/shared/locales/en/) does not have;
 *   - src/renderer has a raw JSX text node, or a literal string in a prop
 *     people read (`title`, `aria-label`, `placeholder` and the like), outside
 *     the allowlist below: those strings belong in the English resources;
 *   - another language has a key English does not, or drops a `{{value}}`
 *     its English has (a translation that would show the wrong thing);
 *   - another language leaves out an English key, or a plural form its own
 *     plural rules need (the app would show that string in English);
 *   - an English string changed after it was translated: the lock file,
 *     src/shared/locales/translated.lock.json, holds a hash of the English
 *     each key was translated from. After updating every language, run
 *     `npm run i18n:stamp` (this script with --stamp) to record the new English.
 * It warns, without failing, about English keys nothing uses.
 *
 * Keys are found as `t('ns:key')`, `t("ns:key")`, `i18nKey="ns:key"` and
 * nested `$t(ns:key)` in the strings themselves. A key built at run time,
 * t(`navigation:shortcuts.${id}`), counts every key under its static prefix
 * as used, and the prefix must exist.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { parseArgs } = require('./lib/args.cjs')
const { projectRoot } = require('./lib/root.cjs')
const { walk: walkFiles } = require('./lib/walk.cjs')

const LOCALES = path.join(projectRoot, 'src', 'shared', 'locales')
const SOURCE_LANGUAGE = 'en'
const LOCK_FILE = path.join(LOCALES, 'translated.lock.json')
const DEFAULT_NAMESPACE = 'common'
// scripts/: the user guide's shortcuts page is written from strings (generate-shortcuts-doc.cjs).
// The Android app (mobile/) reads the same resources, under the mobile namespace.
const CODE_ROOTS = ['src', 'electron', 'scripts', 'mobile/src', 'mobile/App.tsx']

/**
 * Files in src/renderer that may hold raw text, by path relative to
 * src/renderer (forward slashes), each with the reason.
 */
const ALLOWLIST = {
  'views/dev/UiGallery.tsx': 'the component gallery, a development-only page (/dev/ui)'
}

/** Props whose string value people read or hear. */
const TEXT_PROPS = new Set([
  'title',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'placeholder',
  'alt',
  'label',
  'hint',
  'description',
  'legend',
  'heading',
  'subtitle',
  'emptyText',
  'confirmLabel',
  'cancelLabel',
  'actionLabel',
  'valueText',
  'tooltip',
  'content',
  'unit'
])

/** Props named for text: `submitLabel`, `disabledReason`, `emptyTitle`. */
const TEXT_PROP_SUFFIX =
  /[a-z](Label|Title|Text|Hint|Description|Reason|Message|Placeholder|Heading|Header|Caption|Tooltip|Legend)$/

/**
 * Whether a string is something to translate: it has a letter in it, and it
 * is not technical text that reads the same in every language, such as a
 * path, a URL or a branch prefix ("origin/", "http://127.0.0.1:").
 */
function hasWords(text) {
  const trimmed = text.trim()
  if (/^[\w./:@#?=&%+-]+$/.test(trimmed) && /[/:@]/.test(trimmed)) return false
  return /\p{L}/u.test(text)
}

/** The text a JSX text node renders, with JSX's whitespace rules. */
function jsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/)
  let lastNonEmpty = 0
  lines.forEach((line, index) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = index
  })
  let out = ''
  lines.forEach((line, index) => {
    let text = line.replace(/\t/g, ' ')
    if (index !== 0) text = text.replace(/^[ ]+/, '')
    if (index !== lines.length - 1) text = text.replace(/[ ]+$/, '')
    if (text) out += index !== lastNonEmpty ? `${text} ` : text
  })
  return out
}

function scriptKind(file) {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

/**
 * Parses one file. Parsing is most of the checker's time, so `check` parses
 * each file once and hands the tree to both passes. JSDoc is left unparsed:
 * `ts.forEachChild` never visits it, so neither pass could see it anyway.
 * Parent pointers are not set (`setParentNodes: false`); a pass that needs a
 * node's parent tracks it while it walks.
 */
function parse(source, file) {
  return ts.createSourceFile(
    file,
    source,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    false,
    scriptKind(file)
  )
}

/**
 * Raw text in one renderer file: JSX text nodes and literal strings in text
 * props. Returns `{ line, message }` problems.
 */
function checkRendererSource(source, file = 'file.tsx') {
  return rendererProblems(parse(source, file))
}

function rendererProblems(sf) {
  const problems = []
  const report = (node, message) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    problems.push({ line: line + 1, message })
  }
  const literalText = (node) => {
    if (!node) return null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isJsxExpression(node)) return literalText(node.expression)
    if (ts.isTemplateExpression(node)) {
      return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ')
    }
    if (ts.isConditionalExpression(node)) {
      return [literalText(node.whenTrue), literalText(node.whenFalse)].filter(Boolean).join(' ')
    }
    if (ts.isParenthesizedExpression(node)) return literalText(node.expression)
    return null
  }
  // The parent is passed down rather than read from `node.parent`: `parse`
  // skips setting parent pointers, which costs a quarter of the parse.
  const visit = (node, parent) => {
    if (ts.isJsxText(node)) {
      const text = jsxText(node.text)
      if (hasWords(text)) report(node, `raw JSX text "${text.slice(0, 60)}"`)
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf)
      const text = literalText(node.initializer)
      if ((TEXT_PROPS.has(name) || TEXT_PROP_SUFFIX.test(name)) && text && hasWords(text)) {
        report(node, `literal ${name}="${text.slice(0, 60)}"`)
      }
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      parent &&
      (ts.isJsxElement(parent) || ts.isJsxFragment(parent))
    ) {
      const text = literalText(node.expression)
      if (text && hasWords(text)) report(node, `raw JSX string "${text.slice(0, 60)}"`)
    }
    ts.forEachChild(node, (child) => visit(child, node))
  }
  visit(sf, undefined)
  return problems
}

/** Keys a source file uses: exact keys and run-time prefixes, each `ns:key`. */
function keysInSource(source, file = 'file.tsx') {
  return sourceKeys(parse(source, file))
}

function sourceKeys(sf) {
  const exact = new Set()
  const prefixes = new Set()
  const qualify = (key) => (key.includes(':') ? key : `${DEFAULT_NAMESPACE}:${key}`)
  const add = (node) => {
    if (!node) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      exact.add(qualify(node.text))
    } else if (ts.isTemplateExpression(node)) {
      prefixes.add(qualify(node.head.text.replace(/\.$/, '')))
    } else if (ts.isConditionalExpression(node)) {
      add(node.whenTrue)
      add(node.whenFalse)
    } else if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) {
      add(node.expression)
    }
  }
  const visit = (node) => {
    // Any literal that names a key ('tasks:drawer.title') counts, wherever it
    // is: a key may be kept in data and translated where it is shown.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (KEY_LITERAL.test(node.text)) exact.add(node.text)
    } else if (ts.isTemplateExpression(node) && KEY_PREFIX.test(node.head.text)) {
      prefixes.add(node.head.text.replace(/\.$/, ''))
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) &&
            ts.isIdentifier(callee.expression) &&
            callee.expression.text === 'i18n'
          ? `i18n.${callee.name.text}`
          : null
      if (name === 't' || name === 'i18n.t' || name === 'msg') add(node.arguments[0])
    } else if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'i18nKey') {
      add(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { exact, prefixes }
}

/** The source files under a folder, leaving out node_modules, the locales and .d.ts. */
function walk(dir) {
  return walkFiles(dir, {
    skipDirs: ['node_modules', 'locales'],
    include: (name) => /\.(ts|tsx|cts|cjs)$/.test(name) && !name.endsWith('.d.ts')
  })
}

/** A namespace tree flattened to `key → text`. */
function flatten(tree, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(full, value)
    else if (value && typeof value === 'object') flatten(value, full, out)
  }
  return out
}

const NAMESPACES = fs.existsSync(path.join(LOCALES, SOURCE_LANGUAGE))
  ? fs
      .readdirSync(path.join(LOCALES, SOURCE_LANGUAGE))
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
  : []
const KEY_LITERAL = new RegExp(`^(${NAMESPACES.join('|')}):[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+$`)
const KEY_PREFIX = new RegExp(`^(${NAMESPACES.join('|')}):([A-Za-z0-9_]+\\.)+$`)

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

/** Every language's strings: language → `ns:key` → text. */
function loadLocales(root = LOCALES) {
  const languages = new Map()
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const strings = new Map()
    for (const file of fs.readdirSync(path.join(root, entry.name))) {
      if (!file.endsWith('.json')) continue
      const namespace = file.slice(0, -'.json'.length)
      const tree = JSON.parse(fs.readFileSync(path.join(root, entry.name, file), 'utf8'))
      for (const [key, text] of flatten(tree)) strings.set(`${namespace}:${key}`, text)
    }
    languages.set(entry.name, strings)
  }
  return languages
}

/** Every `key.slice(0, i)` where `key[i]` is `separator`: the key's heads. */
function heads(key, separator) {
  const out = []
  for (let i = key.indexOf(separator); i !== -1; i = key.indexOf(separator, i + 1)) {
    out.push(key.slice(0, i))
  }
  return out
}

/**
 * Lookups over English's keys, built once per check so that each question is
 * a set lookup rather than a scan of every key (the scans grew with the
 * number of strings times the number of keys used, and had become about a
 * third of the checker's time).
 *   - `hasKey(key)`: English has `key`, directly or as plural forms and
 *     contexts (`key_one`, `key_hours`, `key_hours_one`; not `key_comment`).
 *   - `hasKeysUnder(prefix)`: some English key starts with `prefix.`.
 */
function englishIndex(english) {
  const underscoreHeads = new Set()
  const dotHeads = new Set()
  for (const candidate of english.keys()) {
    if (!candidate.endsWith('_comment')) {
      for (const head of heads(candidate, '_')) underscoreHeads.add(head)
    }
    for (const head of heads(candidate, '.')) dotHeads.add(head)
  }
  return {
    hasKey: (key) => english.has(key) || underscoreHeads.has(key),
    hasKeysUnder: (prefix) => dotHeads.has(prefix)
  }
}

function placeholders(text) {
  return new Set([...text.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((match) => match[1]))
}

/** A short hash of an English string, as the lock file keeps it. */
function sourceHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 10)
}

/**
 * The keys a language needs for every English key: each key itself, except
 * that a plural group (`key_one`, `key_other`) needs the forms of the
 * language's own plural rules, ordinal ones for `key_ordinal_…`.
 * Returns `englishKey → [keys the language must have]`.
 */
function requiredKeys(english, language) {
  const cardinal = new Intl.PluralRules(language).resolvedOptions().pluralCategories
  const ordinal = new Intl.PluralRules(language, { type: 'ordinal' }).resolvedOptions()
    .pluralCategories
  const out = new Map()
  for (const key of english.keys()) {
    if (key.endsWith('_comment')) continue
    const base = key.replace(PLURAL_SUFFIX, '')
    if (base !== key && english.has(`${base}_other`)) {
      // The whole group is asked for once, at its `_other` form.
      if (!key.endsWith('_other')) continue
      const forms = base.endsWith('_ordinal') ? ordinal : cardinal
      out.set(
        key,
        forms.map((form) => `${base}_${form}`)
      )
    } else {
      out.set(key, [key])
    }
  }
  return out
}

/** The plural group's English keys for `key`, or just `key`. */
function groupOf(english, key) {
  const base = key.replace(PLURAL_SUFFIX, '')
  if (base === key || !english.has(`${base}_other`)) return [key]
  return [...english.keys()].filter(
    (k) => k.replace(PLURAL_SUFFIX, '') === base && k !== `${base}_comment`
  )
}

/** The lock file: `ns:key → hash of the English it was translated from`. */
function readLock(file = LOCK_FILE) {
  if (!fs.existsSync(file)) return new Map()
  return new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))))
}

/**
 * The lock for the strings as they are: every English key that every other
 * language has translated, with the hash of its English. A key some language
 * still lacks is left out, so it is recorded once it is translated.
 */
function stampedLock(languages) {
  const english = languages.get(SOURCE_LANGUAGE) ?? new Map()
  const others = [...languages].filter(([language]) => language !== SOURCE_LANGUAGE)
  // With English alone there is nothing translated to keep in step.
  if (others.length === 0) return {}
  const translated = new Set(english.keys())
  for (const [language, strings] of others) {
    for (const [key, needed] of requiredKeys(english, language)) {
      if (needed.some((k) => !strings.has(k))) {
        for (const k of groupOf(english, key)) translated.delete(k)
      }
    }
  }
  const lock = {}
  for (const key of [...english.keys()].sort()) {
    if (!key.endsWith('_comment') && translated.has(key)) lock[key] = sourceHash(english.get(key))
  }
  return lock
}

/** Translation errors: keys a language leaves out, and English changed since. */
function translationProblems(languages, lock) {
  const errors = []
  const english = languages.get(SOURCE_LANGUAGE) ?? new Map()
  const missing = new Map()
  for (const [language, strings] of languages) {
    if (language === SOURCE_LANGUAGE) continue
    for (const [, needed] of requiredKeys(english, language)) {
      for (const key of needed) {
        if (strings.has(key)) continue
        if (!missing.has(key)) missing.set(key, [])
        missing.get(key).push(language)
      }
    }
  }
  for (const [key, list] of missing) errors.push(`${list.join(', ')}: ${key} is not translated`)
  const stamped = stampedLock(languages)
  for (const [key, hash] of Object.entries(stamped)) {
    const was = lock.get(key)
    if (was === undefined) {
      errors.push(`en: ${key} is translated but not in the lock; run npm run i18n:stamp`)
    } else if (was !== hash) {
      errors.push(
        `en: ${key} changed after it was translated; update every language, then run npm run i18n:stamp`
      )
    }
  }
  return errors
}

function check({
  root = projectRoot,
  locales = LOCALES,
  lockFile = path.join(locales, 'translated.lock.json')
} = {}) {
  const errors = []
  const warnings = []
  const languages = loadLocales(locales)
  const english = languages.get(SOURCE_LANGUAGE) ?? new Map()
  const { hasKey, hasKeysUnder } = englishIndex(english)

  const used = new Set()
  const prefixes = new Set()
  for (const codeRoot of CODE_ROOTS) {
    const rootPath = path.join(root, codeRoot)
    if (!fs.existsSync(rootPath)) continue
    const files = fs.statSync(rootPath).isDirectory() ? walk(rootPath) : [rootPath]
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      const relative = path.relative(root, file).replace(/\\/g, '/')
      const sf = parse(source, file)
      const keys = sourceKeys(sf)
      for (const key of keys.exact) {
        used.add(key)
        if (!hasKey(key)) errors.push(`${relative}: unknown key ${key}`)
      }
      for (const prefix of keys.prefixes) {
        prefixes.add(prefix)
        if (!hasKeysUnder(prefix)) errors.push(`${relative}: no keys under ${prefix}`)
      }
      if (relative.startsWith('src/renderer/') && /\.tsx?$/.test(relative)) {
        const inRenderer = relative.slice('src/renderer/'.length)
        if (ALLOWLIST[inRenderer]) continue
        for (const problem of rendererProblems(sf)) {
          errors.push(`${relative}:${problem.line}: ${problem.message}`)
        }
      }
    }
  }

  // Nested keys: "$t(common:count.task, { … })" inside a string uses that key.
  for (const text of english.values()) {
    for (const match of text.matchAll(/\$t\(([^,)]+)/g)) {
      const key = match[1].trim()
      used.add(key.includes(':') ? key : `${DEFAULT_NAMESPACE}:${key}`)
    }
  }

  // The product's names come from brand.ts through {{brand}}, {{brandFull}}
  // and {{aiName}}, never typed into a string (D3: the name may change).
  const brandFile = path.join(root, 'src', 'shared', 'brand.ts')
  if (fs.existsSync(brandFile)) {
    const brand = fs.readFileSync(brandFile, 'utf8')
    const names = ['fullName', 'aiName', 'name']
      .map((name) => new RegExp(`\\b${name}:\\s*'([^']*)'`).exec(brand)?.[1])
      .filter(Boolean)
      .map((name) => ({ name, pattern: new RegExp(`\\b${name}\\b`) }))
    for (const [key, text] of english) {
      const named = names.find(({ pattern }) => pattern.test(text))?.name
      if (named)
        errors.push(`en: ${key} names "${named}"; use {{brand}}, {{brandFull}} or {{aiName}}`)
    }
  }

  for (const key of english.keys()) {
    if (key.endsWith('_comment')) {
      const target = key.slice(0, -'_comment'.length)
      if (!hasKey(target)) errors.push(`en: ${key} comments on a key that does not exist`)
      continue
    }
    const base = key.replace(PLURAL_SUFFIX, '')
    // Used directly, through a key it is a plural or context of (`used_…`),
    // or under a run-time prefix (`prefix.…`).
    const isUsed =
      used.has(key) ||
      used.has(base) ||
      heads(key, '_').some((head) => used.has(head)) ||
      heads(key, '.').some((head) => prefixes.has(head))
    if (!isUsed) warnings.push(`en: unused key ${key}`)
  }

  for (const [language, strings] of languages) {
    if (language === SOURCE_LANGUAGE) continue
    for (const [key, text] of strings) {
      if (key.endsWith('_comment')) continue
      const base = key.replace(PLURAL_SUFFIX, '')
      const source = english.get(key) ?? english.get(`${base}_other`) ?? english.get(base)
      if (source === undefined) {
        errors.push(`${language}: ${key} is not in English`)
        continue
      }
      const translated = placeholders(text)
      const missing = [...placeholders(source)].filter(
        (name) => name !== 'count' && !translated.has(name)
      )
      if (missing.length > 0) {
        errors.push(`${language}: ${key} leaves out {{${missing.join('}}, {{')}}}`)
      }
    }
  }
  errors.push(...translationProblems(languages, readLock(lockFile)))
  return { errors, warnings }
}

function main(argv) {
  const args = parseArgs(argv)
  if (args.has('--stamp')) {
    const lock = stampedLock(loadLocales())
    fs.writeFileSync(
      LOCK_FILE,
      `${JSON.stringify(lock, null, 2)}
`
    )
    process.stdout
      .write(`check-i18n: recorded the English of ${Object.keys(lock).length} translated key(s).
`)
    return 0
  }
  const { errors, warnings } = check()
  const verbose = args.has('--warnings')
  if (warnings.length > 0) {
    if (verbose) for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`)
    else
      process.stderr.write(
        `check-i18n: ${warnings.length} unused English key(s); run with --warnings to list them.\n`
      )
  }
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`${error}\n`)
    process.stderr.write(
      `\ncheck-i18n: ${errors.length} problem(s). Move user-facing text into src/shared/locales/en/, and translate new or changed English into every language (docs/translating.md).\n`
    )
    return 1
  }
  return 0
}

module.exports = {
  checkRendererSource,
  keysInSource,
  check,
  jsxText,
  requiredKeys,
  stampedLock,
  translationProblems,
  sourceHash,
  ALLOWLIST,
  TEXT_PROPS
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))
