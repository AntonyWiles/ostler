import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  check,
  checkRendererSource,
  jsxText,
  keysInSource,
  sameAsEnglishProblems,
  sourceHash
} from '../../scripts/check-i18n.cjs'

describe('check-i18n (P11.1)', () => {
  describe('raw text in the renderer', () => {
    it('flags a raw JSX string', () => {
      const problems = checkRendererSource(
        'export const A = () => <p>Delete the task</p>\n',
        'Sample.tsx'
      )
      expect(problems).toEqual([{ line: 1, message: 'raw JSX text "Delete the task"' }])
    })

    it('passes a t() call', () => {
      const source = [
        "import { t } from '@shared/i18n'",
        "export const A = () => <p>{t('tasks:drawer.delete')}</p>"
      ].join('\n')
      expect(checkRendererSource(source, 'Sample.tsx')).toEqual([])
    })

    it('flags literal text props, string children and conditional text', () => {
      const source = [
        'export const A = ({ on }: { on: boolean }) => (',
        '  <div>',
        '    <button title="Close" aria-label="Close the dialog" placeholder="Search" />',
        "    <Field submitLabel=\"Save\" label={on ? 'On' : 'Off'} />",
        "    {'Nothing here'}",
        '  </div>',
        ')'
      ].join('\n')
      const messages = checkRendererSource(source, 'Sample.tsx').map((problem) => problem.message)
      expect(messages).toEqual([
        'literal title="Close"',
        'literal aria-label="Close the dialog"',
        'literal placeholder="Search"',
        'literal submitLabel="Save"',
        'literal label="On Off"',
        'raw JSX string "Nothing here"'
      ])
    })

    it('leaves punctuation, numbers, class names and technical text alone', () => {
      const source = [
        'export const A = () => (',
        '  <p className="ui-thing is-active" data-kind="task-card">',
        "    · {3} / <code>{'origin/'}</code> {'http://127.0.0.1:'}",
        '  </p>',
        ')'
      ].join('\n')
      expect(checkRendererSource(source, 'Sample.tsx')).toEqual([])
    })

    it('reads JSX text the way React renders it', () => {
      expect(jsxText('\n    Delete\n    the task\n  ')).toBe('Delete the task')
      expect(jsxText('Click ')).toBe('Click ')
    })
  })

  describe('keys used in code', () => {
    it('finds t() calls, Trans keys, literal keys and run-time prefixes', () => {
      const source = [
        "t('tasks:drawer.title')",
        "i18n.t('views:home.greeting', { name })",
        '<Trans i18nKey="settings:general.title" />',
        "const KEY = 'navigation:views.home.label'",
        't(`navigation:shortcuts.${id}`)',
        "t(cond ? 'common:a.yes' : 'common:a.no')"
      ].join('\n')
      const { exact, prefixes } = keysInSource(source, 'Sample.tsx')
      expect([...exact].sort()).toEqual([
        'common:a.no',
        'common:a.yes',
        'navigation:views.home.label',
        'settings:general.title',
        'tasks:drawer.title',
        'views:home.greeting'
      ])
      expect([...prefixes]).toEqual(['navigation:shortcuts'])
    })
  })

  describe('a whole tree', () => {
    let dir: string | null = null
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true })
      dir = null
    })

    function tree(files: Record<string, string>): string {
      dir = mkdtempSync(join(tmpdir(), 'ostler-i18n-'))
      for (const [name, content] of Object.entries(files)) {
        const path = join(dir, name)
        mkdirSync(join(path, '..'), { recursive: true })
        writeFileSync(path, content)
      }
      return dir
    }

    const run = (root: string) => check({ root, locales: join(root, 'src/shared/locales') })

    it('fails on a key English does not have, and warns about an unused one', () => {
      const root = tree({
        'src/shared/locales/en/common.json': JSON.stringify({
          a: { used: 'Used', spare: 'Spare' },
          count: { task_one: '{{count}} task', task_other: '{{count}} tasks' }
        }),
        'src/renderer/A.tsx':
          "t('common:a.used'); t('common:a.missing'); t('common:count.task', { count: 2 })\n"
      })
      const { errors, warnings } = run(root)
      expect(errors).toEqual(['src/renderer/A.tsx: unknown key common:a.missing'])
      expect(warnings).toEqual(['en: unused key common:a.spare'])
    })

    it("fails on another language's stray key or lost placeholder", () => {
      const root = tree({
        'src/shared/locales/en/common.json': JSON.stringify({ a: { hello: 'Hello {{name}}' } }),
        'src/shared/locales/de/common.json': JSON.stringify({
          a: { hello: 'Hallo', extra: 'Extra' }
        }),
        'src/shared/locales/translated.lock.json': JSON.stringify({
          'common:a.hello': sourceHash('Hello {{name}}')
        }),
        'src/renderer/A.tsx': "t('common:a.hello', { name })\n"
      })
      expect(run(root).errors).toEqual([
        'de: common:a.hello leaves out {{name}}',
        'de: common:a.extra is not in English'
      ])
    })

    it('fails on an English key or plural form a language leaves out', () => {
      const root = tree({
        'src/shared/locales/en/common.json': JSON.stringify({
          a: {
            done: 'Done',
            added: 'Added',
            item_one: '{{count}} item',
            item_other: '{{count}} items'
          }
        }),
        'src/shared/locales/de/common.json': JSON.stringify({
          a: { done: 'Fertig', item_one: '{{count}} Element', item_other: '{{count}} Elemente' }
        }),
        // French plurals have a `many` form ("1 000 000 d'éléments").
        'src/shared/locales/fr/common.json': JSON.stringify({
          a: {
            done: 'Terminé',
            added: 'Ajouté',
            item_one: '{{count}} élément',
            item_other: '{{count}} éléments'
          }
        }),
        'src/shared/locales/translated.lock.json': JSON.stringify({
          'common:a.done': sourceHash('Done')
        }),
        'src/renderer/A.tsx':
          "t('common:a.done'); t('common:a.added'); t('common:a.item', { count })\n"
      })
      expect(run(root).errors).toEqual([
        'de: common:a.added is not translated',
        'fr: common:a.item_many is not translated'
      ])
    })

    it('fails when English changed after it was translated, until it is stamped', () => {
      const root = tree({
        'src/shared/locales/en/common.json': JSON.stringify({ a: { save: 'Save changes' } }),
        'src/shared/locales/de/common.json': JSON.stringify({ a: { save: 'Speichern' } }),
        'src/shared/locales/translated.lock.json': JSON.stringify({
          'common:a.save': sourceHash('Save')
        }),
        'src/renderer/A.tsx': "t('common:a.save')\n"
      })
      expect(run(root).errors).toEqual([
        'en: common:a.save changed after it was translated; update every language, then run npm run i18n:stamp'
      ])
      writeFileSync(
        join(root, 'src/shared/locales/translated.lock.json'),
        JSON.stringify({ 'common:a.save': sourceHash('Save changes') })
      )
      expect(run(root).errors).toEqual([])
    })

    it('fails on a string left the same as English, unless allowed', () => {
      const english = {
        save: 'Save changes',
        status: 'Status',
        github: 'GitHub',
        hours: '{{count}} h'
      }
      const root = tree({
        'src/shared/locales/en/common.json': JSON.stringify({ a: english }),
        // "Save changes" pasted in, not translated; the rest may stay as they are.
        'src/shared/locales/de/common.json': JSON.stringify({ a: english }),
        'src/shared/locales/fr/common.json': JSON.stringify({
          a: { ...english, save: 'Enregistrer', status: 'Statut' }
        }),
        'src/shared/locales/same-as-english.json': JSON.stringify({
          Status: ['de'],
          GitHub: '*',
          Gone: '*'
        }),
        'src/shared/locales/translated.lock.json': JSON.stringify(
          Object.fromEntries(
            Object.entries(english).map(([key, text]) => [`common:a.${key}`, sourceHash(text)])
          )
        ),
        'src/renderer/A.tsx': Object.keys(english)
          .map((key) => `t('common:a.${key}')`)
          .join('; ')
      })
      expect(run(root).errors).toEqual([
        'de: common:a.save is the same as English ("Save changes"); translate it, or allow it in same-as-english.json',
        'same-as-english.json: "Gone" matches no string; remove it'
      ])
    })

    it('flags every language that pastes the same English, in one error', () => {
      expect(
        sameAsEnglishProblems(
          new Map([
            ['en', new Map([['common:a.save', 'Save']])],
            ['de', new Map([['common:a.save', 'Save']])],
            ['ja', new Map([['common:a.save', 'Save']])]
          ]),
          new Map()
        )
      ).toEqual([
        'de, ja: common:a.save is the same as English ("Save"); translate it, or allow it in same-as-english.json'
      ])
    })

    it('fails on a string that types out the product name', () => {
      const root = tree({
        'src/shared/brand.ts':
          "export const BRAND = { name: 'Ostler', fullName: 'Ostler', aiName: 'Ostler AI' }\n",
        'src/shared/locales/en/common.json': JSON.stringify({
          a: { open: 'Open Ostler', fine: 'Open {{brand}}' }
        }),
        'src/renderer/A.tsx': "t('common:a.open'); t('common:a.fine')\n"
      })
      expect(run(root).errors).toEqual([
        'en: common:a.open names "Ostler"; use {{brand}}, {{brandFull}} or {{aiName}}'
      ])
    })

    // It parses every source file in src/, electron/ and scripts/ with TypeScript: about
    // 1.5 s on an idle machine, and well past Vitest's default 5 s while the other
    // workers of a full run hold every core. The work is the test, so it gets the time.
    it('passes the real repository, with no unused English key', { timeout: 30_000 }, () => {
      const { errors, warnings } = check()
      expect(errors).toEqual([])
      expect(warnings).toEqual([])
    })
  })
})
