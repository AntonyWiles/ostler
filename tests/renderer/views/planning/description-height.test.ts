// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { holdDescriptionHeight } from '@renderer/views/planning/WorkItemDrawer'

const sized = <T extends HTMLElement>(element: T, height: number, scrollHeight = height): T => {
  Object.defineProperty(element, 'offsetHeight', { configurable: true, get: () => height })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => height })
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  return element
}

/** Switching the description between its text and its edit box keeps its height. */
describe('holdDescriptionHeight', () => {
  it('gives the edit box the height the text took', () => {
    const editor = sized(document.createElement('textarea'), 40)
    const box = sized(document.createElement('div'), 60)
    box.append(editor)
    holdDescriptionHeight(box, 100, editor)
    expect(editor.style.height).toBe('80px')
    expect(editor.style.overflowY).toBe('hidden')
  })

  it('scrolls the edit box when the raw text is longer than the text was', () => {
    const editor = sized(document.createElement('textarea'), 200, 200)
    const box = sized(document.createElement('div'), 220)
    box.append(editor)
    holdDescriptionHeight(box, 120, editor)
    expect(editor.style.height).toBe('100px')
  })

  it('keeps the edit box height on the text after editing', () => {
    const shown = sized(document.createElement('div'), 50)
    const box = sized(document.createElement('div'), 50)
    box.append(shown)
    holdDescriptionHeight(box, 90, null)
    expect(shown.style.minHeight).toBe('90px')
  })
})
