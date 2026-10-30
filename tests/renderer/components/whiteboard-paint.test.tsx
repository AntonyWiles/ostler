// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { cleanWhiteboardObject, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import { fillClass, textClass, textPaint } from '@renderer/components/whiteboard/paint'
import { TextEditor } from '@renderer/components/whiteboard/TextEditor'
import { WhiteboardScene } from '@renderer/components/whiteboard/WhiteboardScene'

/**
 * One rule for the colours of an object's words: the scene draws them with
 * it, and the text box that edits them takes the same colours, so editing a
 * yellow note shows a yellow note in the dark theme too.
 */

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 200, height: 120, z: 1, ...fields })
}

const note = object({ id: 'n', kind: 'note', text: 'Plan', colour: 'yellow' })
const solid = object({
  id: 's',
  kind: 'shape',
  text: 'Go',
  colour: 'blue',
  data: { shape: 'rectangle', fill: 'solid' }
})
const light = object({
  id: 'l',
  kind: 'shape',
  text: 'Maybe',
  colour: 'green',
  data: { shape: 'ellipse', fill: 'light' }
})
const outline = object({
  id: 'o',
  kind: 'shape',
  text: 'Empty',
  colour: 'red',
  data: { shape: 'diamond', fill: 'none' }
})
const words = object({ id: 't', kind: 'text', text: 'Title', colour: 'purple' })
const frame = object({ id: 'f', kind: 'frame', text: 'Area', colour: 'teal' })
const idea = object({ id: 'm', kind: 'mindmap', text: 'Idea', colour: 'orange' })
const branch = object({
  id: 'b',
  kind: 'mindmap',
  text: 'Branch',
  colour: 'orange',
  data: { parentId: 'm' }
})

describe('textPaint', () => {
  it('gives every kind with words its fill and text colour', () => {
    expect(textPaint(note)).toEqual({ fill: 'yellow-light', text: 'ink' })
    expect(textPaint(solid)).toEqual({ fill: 'blue', text: 'on-blue' })
    expect(textPaint(light)).toEqual({ fill: 'green-light', text: 'ink' })
    expect(textPaint(outline)).toEqual({ fill: null, text: 'ink' })
    expect(textPaint(words)).toEqual({ fill: null, text: 'purple' })
    expect(textPaint(frame)).toEqual({ fill: null, text: 'teal' })
    // A central idea is solid in its colour; the ideas off it are light.
    expect(textPaint(idea)).toEqual({ fill: 'orange', text: 'on-orange' })
    expect(textPaint(branch)).toEqual({ fill: 'orange-light', text: 'ink' })
  })

  it('names the scene classes for each paint', () => {
    expect(fillClass('paper')).toBe('wb-paper')
    expect(fillClass('yellow-light')).toBe('wb-fill-light-yellow')
    expect(fillClass('blue')).toBe('wb-fill-blue')
    expect(textClass('ink')).toBe('wb-ink')
    expect(textClass('on-blue')).toBe('wb-text-on-blue')
    expect(textClass('purple')).toBe('wb-text-purple')
  })
})

describe('the scene and the text box use the same colours', () => {
  const viewport = { x: 0, y: 0, zoom: 1 }

  it.each([note, solid, light, outline, words, frame, idea])('$kind $colour', (shown) => {
    const paint = textPaint(shown)
    const { container, unmount } = render(
      <WhiteboardScene
        objects={[shown]}
        viewBox={{ x: 0, y: 0, width: 400, height: 300 }}
        imageUrl={() => null}
        measure={(text, size) => text.length * size * 0.5}
      />
    )
    expect(container.querySelector(`text.${textClass(paint.text)}`)).not.toBeNull()
    if (paint.fill) expect(container.querySelector(`.${fillClass(paint.fill)}`)).not.toBeNull()
    unmount()

    render(<TextEditor object={shown} viewport={viewport} onText={vi.fn()} onDone={vi.fn()} />)
    const box = screen.getByRole('textbox')
    expect(box.style.background).toBe(`var(--whiteboard-${paint.fill ?? 'paper'})`)
    expect(box.style.color).toBe(`var(--whiteboard-${paint.text})`)
  })
})
