# Translating Ostler

Ostler's interface is written in English and ships in seven other languages, all machine-translated
from English (see [Bundled languages](#bundled-languages)). Every word people read lives in one
place, `src/shared/locales/`, and the app shows a language as soon as its folder is there.
Translations come from contributors: this page is everything you need to add one, keep it up to
date, and get it reviewed.

## Bundled languages

Ostler ships with these languages, each machine-translated from English. Corrections from native
speakers are welcome.

- German, `de`
- French, `fr`
- Spanish, `es`
- Italian, `it`
- Brazilian Portuguese, `pt-BR`
- Japanese, `ja`
- Simplified Chinese, `zh-Hans`

To correct one, edit its JSON files in `src/shared/locales/<tag>/`, such as
`src/shared/locales/de/tasks.json`. Change only the values: keep every key and `{{placeholder}}`
exactly as English has it. Then check with `node scripts/check-i18n.cjs` (`npm run lint` runs it too)
and open a pull request.

## How it fits together

- The strings are JSON files, one per area of the app ("namespace"), in
  `src/shared/locales/<language>/`. English, in `src/shared/locales/en/`, is the source: every key
  exists there first.
- The namespaces are `common`, `navigation`, `tasks`, `views`, `settings`, `ai`, `agents`, `library`,
  `projects`, `data`, `onboarding`, `help`, `errors`, `desktop` (the menus, tray and
  notifications) and `mobile` (the Android app).
- Ostler uses [i18next](https://www.i18next.com/). Main and the window share one set-up,
  `src/shared/i18n/`.
- People choose the language in **Settings › General › Language**. "Match Windows", the default,
  picks the first of their Windows display languages that Ostler has, and falls back to English.
  Changing it takes effect at once, menus and tray included.
- If a key is ever missing from a language, the app shows it in English. The checker keeps the
  bundled languages complete, so this is only a safety net.
- Dates, times, numbers, file sizes, relative times ("3 days ago") and the first day of the week come
  from Windows' region settings through `Intl`. They need no translation.

## Add a language

1. Pick the language's tag: the [BCP 47](https://www.rfc-editor.org/info/bcp47) code Windows uses,
   such as `de`, `fr`, `ja` or `pt-BR`. Use the bare language (`de`) unless the regional variants
   really differ (`pt-BR` and `pt-PT`).
2. Create `src/shared/locales/<tag>/` and copy into it the English files you will translate, keeping
   their names (`tasks.json`, `settings.json`, and so on). Start with `common`, `navigation` and
   `tasks`: they cover what people see first.
3. Add an `index.ts` to the folder that lists your files, like the English one:

   ```ts
   import common from './common.json'
   import navigation from './navigation.json'
   import tasks from './tasks.json'

   export default { common, navigation, tasks }
   ```

4. Register the language with one line in `src/shared/locales/index.ts`:

   ```ts
   import de from './de'

   export const BUNDLED_LOCALES: Readonly<Record<string, LocaleResources>> = {
     en,
     de
   }
   ```

5. Translate the values. Never change a key, and leave no English text in your file. The checker
   lists every key still to translate.
6. Check it (see [Testing](#testing)) and open a pull request.

The language shows in Settings › General › Language under its own name ("Deutsch", "日本語"), and
"Match Windows" picks it for anyone whose Windows language it is.

## The strings

### Keys

Keys say where a string is used: `tasks:workItemDrawer.discardChanges` is in the `tasks` namespace,
used by the task drawer. In JSON, the part after the colon is nested:

```json
{
  "workItemDrawer": {
    "discardChanges": "Discard your changes?"
  }
}
```

Keep the structure exactly as English has it. A key that ends in `_comment` is a note for translators
about the key beside it ("`{{age}}` is short, such as “3d”"). Read it; do not translate it or copy it
into your file.

### Values that vary

- `{{name}}` is filled in by the app: `"Delete “{{title}}”?"`. Keep every placeholder, spelled
  exactly as in English, and move it wherever your grammar needs it. `npm run lint` fails when a
  translation leaves one out.
- `{{brand}}`, `{{brandFull}}` and `{{aiName}}` are the product's names ("Ostler", "Ostler",
  "Ostler AI"). Never type the names themselves.
- `<strong>…</strong>`, `<code>…</code>`, `<add>…</add>` and the like wrap part of a sentence in
  formatting, and `<kbd/>` marks where a key is shown. Keep the tags, around the matching words of
  your sentence.
- `$t(common:count.task, {"count": {{taskCount}} })` inserts another string, here "3 tasks". Keep it
  as it is.
- Text that reads the same in every language (paths, URLs, Git branch names, code) is never in the
  strings.

### Plurals

A string that depends on a number has one key per plural form, chosen with your language's plural
rules (`Intl.PluralRules`):

```json
{
  "tasksDone_one": "{{count}} task done",
  "tasksDone_other": "{{count}} tasks done"
}
```

English has two forms, `_one` and `_other`. Your language may have more or fewer: `_zero`, `_one`,
`_two`, `_few`, `_many` and `_other`. Write the ones it uses (the
[CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
list them) and leave out the rest. Japanese, for example, needs only `_other`; Polish needs `_one`,
`_few`, `_many` and `_other`.

- Always use `{{count}}` in every form. English's `_one` sometimes says "once" or "The 1 remaining
  task", because in English `_one` only ever means 1; in your language the same form may cover 21 or 101.
- Ordinals ("31st") use `_ordinal_one`, `_ordinal_two`, `_ordinal_few` and `_ordinal_other`, by the
  ordinal rules of your language.

### Context

Some keys come in variants the app picks by context, after an underscore: `flow.held_days` (in the
last 30 days) and `flow.held_milestone` (since the milestone started), or `openUnits_points` and
`openUnits_hours`. Translate each variant; the plural forms go after the context
(`flow.held_days_one`).

### Words and style

Follow the spirit of the English writing: plain and friendly, addressed to "you", sentence case, buttons that start with a verb. Use the words people
in your language already know from Windows for "Settings", "Inbox", "Recycle bin" and the like.

`common:keys.*` are key names as keyboards in your language print them (German keyboards say `Strg`
for `Ctrl`). Translate them only where the keycaps differ.

### What stays in English

The user guide and the changelog (`docs/user-guide/`, `CHANGELOG.md`), the text Ostler sends to AI
models and coding agents, the agent and automation APIs and their help, and the log. These are not
in the strings.

Quick add understands English words only (`tomorrow`, `!high`), whatever the interface language.

### The built-in templates and demo projects

The built-in templates (Blank project, Software project, Moving house and the rest) and the two
demo projects are written once, in English, in their files in `src/shared/templates/`
(`sample.json` and `demo-advanced.json` are the demos). Their words in each language live in
`src/shared/templates/template-text/<tag>.json`, one file for every template, which maps each
English string to its translation. A template is read in the language shown: its name and
description in the New project picker, and the project it makes. Saved templates are not
translated. Keep `{{money:…}}`, `{{currency}}`, `**bold**`, line breaks and list markers as
English has them, and use the interface's own names for views and settings ("Board", "Project
settings › Rules"). A string used in more than one place, such as a label and the rule that
matches it, or "Kitchen" in two templates, is translated once. Mind the package limits: a goal's
unit is at most 20 characters after `{{currency}}` becomes a symbol of up to five ("F CFA").
`tests/unit/template-text.test.ts` fails when a language misses a string or breaks a limit.

## Testing

Run Ostler on a scratch data folder and switch the language:

```powershell
npm run dev:scratch -- translate
```

Open **Settings › General › Language**, choose your language, and walk through Home, a project's
views, a task, Settings and the dialogs. Look at long words in narrow places: buttons, tabs, the
sidebar and the window at its smallest (900 × 600).

### The pseudo-locale

Development builds also offer **Pseudo-locale (en-XA, for testing)** in the language list. It shows
every string accented, about 30% longer, and in brackets: `[Ðéļéţé ţĥé ţàšķ~~~~]`. It is how
developers find text that skipped the strings (it shows without brackets) and text that is cut off
(the closing bracket is missing). The end-to-end suite walks the app in `en-XA` and fails on any
visible text without the brackets (`tests/e2e/pseudo-locale.spec.ts`).

### The checker

`npm run lint` runs `scripts/check-i18n.cjs`. It fails when:

- the code uses a key English does not have;
- `src/renderer` has text typed into the code (JSX text, or a literal `title`, `aria-label`,
  `placeholder`, `label` and the like) instead of a key;
- an English string types out the product's name;
- a translation has a key English does not, or leaves out a `{{placeholder}}`;
- a bundled language leaves out an English key, or a plural form its plural rules need (French,
  Spanish, Italian and Portuguese have a `_many` form English does not);
- an English string changed after it was translated;
- a translation is the same as its English (usually English pasted in rather than translated).

A translation may match English when it has no word of two or more letters once `{{placeholders}}`
are taken out (`{{count}} h`), or when `src/shared/locales/same-as-english.json` allows that
English text in that language: `"GitHub": "*"` for every language, `"Status": ["de", "pt-BR"]` for
some. Add an entry only for names, and for words a language really shares with English. The
checker also fails on an entry that no longer matches any string.

The changed-English check works from `src/shared/locales/translated.lock.json`, which holds a short hash of the
English each key was translated from. When the checker says a string changed, update it in every
language, then record the new English with `npm run i18n:stamp`. The stamp records only keys every
language has, so run it after translating, not instead of it.

It warns about English keys nothing uses. `node scripts/check-i18n.cjs --warnings` lists them.

## For developers adding strings

- Never type a user-facing string into the code. Add it to the English JSON and use
  `t('namespace:area.key')` from `@shared/i18n`, or `<Trans>` from `src/renderer/i18n/Trans` when
  part of the sentence is formatted.
- Keep sentences whole: one key per sentence, with named values (`{ title }`) for what varies and
  `count` for plurals. A choice between sentences is two keys, not a sentence built from pieces.
- Dates, times and numbers go through `@shared/format` and `formatIsoDate` in `@shared/dates`.
- A label kept in a constant is read when it is shown, not when the module loads: a getter
  (`get label() { return t('…') }`) or a function, so a language change reaches it.
- Add a `_comment` key where a string's meaning is not obvious out of context.
- A new or changed English string is translated into every bundled language in the same change,
  then stamped with `npm run i18n:stamp`. `npm run lint` fails until it is.

## Review

A translation pull request changes only its language folder and the one line in
`src/shared/locales/index.ts`. Before it is merged:

1. `npm run lint` passes (no stray keys, no lost placeholders).
2. The author attaches screenshots of a few screens in the language, including Settings and a task,
   at 1280 × 800 and 900 × 600.
3. Where possible, a second fluent speaker reads it. A maintainer who does not speak the language
   checks the structure, the screenshots and that nothing was cut off.
4. The CHANGELOG's Unreleased section gains a line naming the language and its translators.

A bundled language has every English key: the checker fails on any it leaves out, and on English
that changed after it was translated. When English strings change, it also shows a translation's
keys that no longer exist. A new language can start with a few namespaces while it is worked on in
its pull request, but it is complete before it is bundled.
