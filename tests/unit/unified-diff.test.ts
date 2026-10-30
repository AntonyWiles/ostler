import { describe, expect, it } from 'vitest'
import {
  diffLines,
  findDiffFile,
  linesInRange,
  parseUnifiedDiff
} from '../../src/shared/diff/unified-diff'

const MODIFIED = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@ export function a()',
  ' one',
  '-two',
  '+TWO',
  '+two and a half',
  ' three',
  '@@ -10,2 +11,2 @@',
  ' ten',
  '-eleven',
  '+ELEVEN',
  ''
].join('\n')

describe('parseUnifiedDiff', () => {
  it('reads a modified file with several hunks and numbers each line', () => {
    const parsed = parseUnifiedDiff(MODIFIED)
    expect(parsed.files).toHaveLength(1)
    const file = parsed.files[0]
    expect(file).toMatchObject({
      path: 'src/a.ts',
      oldPath: 'src/a.ts',
      newPath: 'src/a.ts',
      added: false,
      deleted: false,
      renamed: false,
      binary: false
    })
    expect(file.hunks).toHaveLength(2)
    expect(file.hunks[0].heading).toBe('export function a()')
    const body = file.hunks[0].lines.map((l) => [l.kind, l.oldLine, l.newLine])
    expect(body).toEqual([
      ['hunk', null, null],
      ['context', 1, 1],
      ['remove', 2, null],
      ['add', null, 2],
      ['add', null, 3],
      ['context', 3, 4]
    ])
    const second = file.hunks[1].lines.map((l) => [l.kind, l.oldLine, l.newLine])
    expect(second).toEqual([
      ['hunk', null, null],
      ['context', 10, 11],
      ['remove', 11, null],
      ['add', null, 12]
    ])
    // Every line of the patch is kept, in order.
    expect(diffLines(parsed).map((l) => l.index)).toEqual([...Array(parsed.lineCount).keys()])
  })

  it('reads added, deleted, renamed and binary files', () => {
    const patch = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-x',
      'diff --git a/old name.ts b/new name.ts',
      'similarity index 90%',
      'rename from old name.ts',
      'rename to new name.ts',
      'diff --git a/pic.png b/pic.png',
      'index 1..2 100644',
      'Binary files a/pic.png and b/pic.png differ'
    ].join('\n')
    const [added, deleted, renamed, binary] = parseUnifiedDiff(patch).files
    expect(added).toMatchObject({ path: 'new.ts', oldPath: null, added: true })
    expect(added.hunks[0].lines.slice(1).map((l) => l.newLine)).toEqual([1, 2])
    expect(deleted).toMatchObject({ path: 'gone.ts', newPath: null, deleted: true })
    expect(deleted.hunks[0].lines[1]).toMatchObject({ kind: 'remove', oldLine: 1 })
    expect(renamed).toMatchObject({
      oldPath: 'old name.ts',
      newPath: 'new name.ts',
      path: 'new name.ts',
      renamed: true
    })
    expect(binary).toMatchObject({ path: 'pic.png', binary: true, hunks: [] })
  })

  it('keeps "no newline at end of file" without numbering it', () => {
    const patch = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file'
    ].join('\n')
    const lines = parseUnifiedDiff(patch).files[0].hunks[0].lines
    expect(lines.map((l) => l.kind)).toEqual(['hunk', 'remove', 'no-newline', 'add', 'no-newline'])
    expect(lines[3].newLine).toBe(1)
  })

  it('reads body lines that look like headers as lines', () => {
    const patch = ['--- a/x', '+++ b/x', '@@ -1,1 +1,1 @@', '---- a rule', '+++++ heading'].join(
      '\n'
    )
    const lines = parseUnifiedDiff(patch).files[0].hunks[0].lines
    expect(lines.map((l) => l.kind)).toEqual(['hunk', 'remove', 'add'])
  })

  it('parses a patch cut short mid-hunk, and an empty one', () => {
    const cut = MODIFIED.split('\n').slice(0, 8).join('\n')
    const file = parseUnifiedDiff(cut).files[0]
    expect(file.hunks[0].lines.at(-1)).toMatchObject({ kind: 'add', newLine: 2 })
    expect(parseUnifiedDiff('')).toEqual({ files: [], preamble: [], lineCount: 0 })
  })
})

describe('finding lines', () => {
  it('finds a file by path and its shown lines in a range', () => {
    const parsed = parseUnifiedDiff(MODIFIED)
    const file = findDiffFile(parsed, './src\\a.ts')!
    expect(file.path).toBe('src/a.ts')
    expect(linesInRange(file, 2, 4).map((l) => l.newLine)).toEqual([2, 3, 4])
    expect(linesInRange(file, 5, 9)).toEqual([])
    expect(findDiffFile(parsed, 'other.ts')).toBeNull()
  })
})
