import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A native `<select>` opens a Windows pop-up when clicked, and an off-screen
 * Ostler must show nothing. The e2e specs choose an option with Playwright's
 * `selectOption`, which never opens it; this refuses a click on a select.
 *
 * A locator is a select when it is a `select` element by CSS, or when any spec
 * calls `selectOption` on the same locator (the same `getBy…`/`locator` call,
 * directly or through a variable). Clicking, double-clicking or tapping one is
 * refused.
 */

const LOCATOR =
  /\.(getByLabel|getByRole|getByTestId|getByPlaceholder|getByTitle|getByText|locator)\(((?:[^()]|\([^()]*\))*)\)/g
/** `.first()`, `.last()` or `.nth(n)` between a locator and what is done with it. */
const PICK = /^(?:\s*\.(?:first|last)\(\)|\s*\.nth\(\s*\d+\s*\))*/
const ACTION = /^\s*\.(\w+)\(/
const CLICKS = new Set(['click', 'dblclick', 'tap'])

const signature = (method: string, args: string) => `${method}(${args.replace(/\s+/g, ' ').trim()})`
const isSelectCss = (method: string, args: string) =>
  method === 'locator' && /^\s*['"`]\s*select\b/.test(args)

interface Use {
  file: string
  line: number
  signature: string
  action: string
  css: boolean
}

/** Every locator call in `text` with what is done with it, directly or through its variable. */
function uses(file: string, text: string): Use[] {
  const found: Use[] = []
  const lineOf = (index: number) => text.slice(0, index).split('\n').length
  const variables = new Map<string, { signature: string; css: boolean }>()
  for (const match of text.matchAll(LOCATOR)) {
    const [whole, method, args] = match
    const end = match.index + whole.length
    const rest = text.slice(end)
    const afterPick = rest.slice(PICK.exec(rest)?.[0].length ?? 0)
    const sig = signature(method, args)
    const css = isSelectCss(method, args)
    const action = ACTION.exec(afterPick)?.[1]
    if (action) {
      found.push({ file, line: lineOf(match.index), signature: sig, action, css })
      continue
    }
    // `const name = page.getByLabel('Priority')`: what is done with `name` counts too.
    const before = text.slice(0, match.index)
    const declared =
      /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?[\w$]+(?:\s*\.\s*[\w$]+\((?:[^()]|\([^()]*\))*\))*\s*$/.exec(
        before
      )
    if (declared && /^\s*(?:\n|;|$)/.test(afterPick)) {
      variables.set(declared[1], { signature: sig, css })
    }
  }
  for (const [name, { signature: sig, css }] of variables) {
    const call = new RegExp(
      `\\b${name}((?:\\s*\\.(?:first|last)\\(\\)|\\s*\\.nth\\(\\s*\\d+\\s*\\))*)\\s*\\.(\\w+)\\(`,
      'g'
    )
    for (const match of text.matchAll(call)) {
      found.push({ file, line: lineOf(match.index), signature: sig, action: match[2], css })
    }
  }
  return found
}

/** Each click on a native select in `sources` (file name to text), as `file:line signature`. */
export function nativeSelectClicks(sources: Record<string, string>): string[] {
  const all = Object.entries(sources).flatMap(([file, text]) => uses(file, text))
  const selects = new Set(
    all.filter((use) => use.action === 'selectOption').map((u) => u.signature)
  )
  return all
    .filter((use) => CLICKS.has(use.action) && (use.css || selects.has(use.signature)))
    .map((use) => `${use.file}:${use.line} ${use.action}s ${use.signature}`)
}

describe('e2e specs and native selects', () => {
  it('finds a click on a select, by CSS, by a locator chosen with selectOption, or through its variable', () => {
    const spec = [
      "await dialog.getByLabel('Priority').selectOption('high')",
      "await drawer.getByLabel('Priority').click()",
      "await page.locator('select[name=status]').first().click()",
      "const groupBy = view.getByLabel('Group by')",
      "await groupBy.selectOption('status')",
      'await groupBy.click()',
      "await page.getByRole('combobox', { name: 'Command palette search' }).click()",
      "await page.getByLabel('Title').click()"
    ].join('\n')
    expect(nativeSelectClicks({ 'sample.spec.ts': spec })).toEqual([
      "sample.spec.ts:2 clicks getByLabel('Priority')",
      "sample.spec.ts:3 clicks locator('select[name=status]')",
      "sample.spec.ts:6 clicks getByLabel('Group by')"
    ])
  })

  it('no spec clicks a native select: they use selectOption', () => {
    const dir = path.resolve(__dirname, '../e2e')
    const sources = Object.fromEntries(
      fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.ts'))
        .map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')])
    )
    expect(Object.keys(sources).length).toBeGreaterThan(5)
    expect(nativeSelectClicks(sources)).toEqual([])
  })
})
