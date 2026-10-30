// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DiffPatch } from '@renderer/components/DiffPatch'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -4,3 +4,3 @@',
  ' keep',
  '-old',
  '+new',
  ' tail'
].join('\n')

function numbers(container: HTMLElement): string[][] {
  return Array.from(container.querySelectorAll('.diff-patch__line')).map((line) =>
    Array.from(line.querySelectorAll('.diff-patch__number')).map((cell) => cell.textContent ?? '')
  )
}

describe('DiffPatch', () => {
  it("shows each line's old and new line number", () => {
    const { container } = render(<DiffPatch patch={PATCH} />)
    expect(numbers(container)).toEqual([
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
      ['4', '4'],
      ['5', ''],
      ['', '5'],
      ['6', '6']
    ])
    expect(container.querySelector('.diff-patch__line--add')?.textContent).toContain('+new')
  })

  it("highlights a file's lines in its new version, and nothing for lines not shown", () => {
    const { container, rerender } = render(
      <DiffPatch patch={PATCH} highlight={{ path: 'src/a.ts', startLine: 5, endLine: 6 }} />
    )
    const marked = () =>
      Array.from(container.querySelectorAll('.diff-patch__line--highlight')).map(
        (line) => line.querySelector('.diff-patch__text')?.textContent
      )
    expect(marked()).toEqual(['+new', ' tail'])
    rerender(
      <DiffPatch patch={PATCH} highlight={{ path: 'src/a.ts', startLine: 40, endLine: 41 }} />
    )
    expect(marked()).toEqual([])
  })
})
