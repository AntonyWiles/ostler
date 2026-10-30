// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  WHITEBOARD_TEMPLATES,
  buildTemplate,
  type WhiteboardTemplate
} from '@renderer/components/whiteboard/templates'
import { objectRect, rectsIntersect } from '@shared/whiteboard/geometry'
import { mindMapChildren } from '@shared/whiteboard/mind-map'
import {
  WHITEBOARD_LIMITS,
  cleanWhiteboardObject,
  type WhiteboardObjectInput
} from '@shared/whiteboard/model'

function build(template: WhiteboardTemplate, projectName = 'Garden shed') {
  let count = 0
  return buildTemplate(template, { projectName, newId: () => `o${++count}` })
}

const kinds = (objects: readonly WhiteboardObjectInput[]) =>
  objects.map((object) => object.kind).sort()
const texts = (objects: readonly WhiteboardObjectInput[], kind: WhiteboardObjectInput['kind']) =>
  objects.filter((object) => object.kind === kind).map((object) => object.text)

describe('whiteboard templates', () => {
  it('offers five templates, Blank first', () => {
    expect(WHITEBOARD_TEMPLATES).toEqual([
      'blank',
      'brainstorm',
      'retrospective',
      'kick-off',
      'journey'
    ])
  })

  it('makes nothing for Blank', () => {
    expect(build('blank')).toEqual([])
  })

  it('makes a mind map around the project name for Brainstorm', () => {
    const objects = build('brainstorm')
    expect(kinds(objects)).toEqual(['mindmap', 'mindmap', 'mindmap', 'mindmap'])
    const root = objects.find(
      (object) => object.kind === 'mindmap' && object.data.parentId === null
    )!
    expect(root.text).toBe('Garden shed')
    expect(mindMapChildren(objects, root.id).map((child) => child.text)).toEqual([
      'Idea 1',
      'Idea 2',
      'Idea 3'
    ])
    // Laid out to the right of the central idea, starting at the top.
    for (const child of mindMapChildren(objects, root.id)) {
      expect(child.x).toBeGreaterThan(root.x + root.width)
    }
    expect(Math.min(...objects.map((object) => object.y))).toBeGreaterThanOrEqual(0)
  })

  it('falls back to "Main idea" when the project has no name', () => {
    const root = build('brainstorm', '   ').find(
      (object) => object.kind === 'mindmap' && object.data.parentId === null
    )!
    expect(root.text).toBe('Main idea')
  })

  it('makes a title and three coloured frames for Retrospective', () => {
    const objects = build('retrospective')
    expect(kinds(objects)).toEqual(['frame', 'frame', 'frame', 'text'])
    expect(texts(objects, 'text')).toEqual(['Retrospective'])
    const frames = objects.filter((object) => object.kind === 'frame')
    expect(frames.map((frame) => [frame.text, frame.colour])).toEqual([
      ['What went well', 'green'],
      ['What could be better', 'orange'],
      ["What we'll try next", 'blue']
    ])
    expect(frames.map((frame) => [frame.x, frame.width, frame.height])).toEqual([
      [0, 400, 560],
      [440, 400, 560],
      [880, 400, 560]
    ])
  })

  it('makes a title with the project name and six frames for Project kick-off', () => {
    const objects = build('kick-off')
    expect(kinds(objects)).toEqual([...Array(6).fill('frame'), 'text'])
    expect(texts(objects, 'text')).toEqual(['Garden shed: kick-off'])
    expect(texts(objects, 'frame')).toEqual([
      'Goal',
      "Who it's for",
      "What's in",
      "What's out",
      'Risks',
      'Next steps'
    ])
    const frames = objects.filter((object) => object.kind === 'frame')
    expect(new Set(frames.map((frame) => frame.x))).toEqual(new Set([0, 440, 880]))
    const rows = [...new Set(frames.map((frame) => frame.y))]
    expect(rows).toHaveLength(2)
    expect(rows[1] - rows[0]).toBe(340)
    expect(texts(build('kick-off', ''), 'text')).toEqual(['Project kick-off'])
  })

  it('joins the journey map’s five stages with four arrows stuck to neighbours', () => {
    const objects = build('journey')
    expect(kinds(objects)).toEqual([
      ...Array(4).fill('connector'),
      ...Array(5).fill('frame'),
      ...Array(4).fill('text')
    ])
    const frames = objects.filter((object) => object.kind === 'frame')
    expect(frames.map((frame) => frame.text)).toEqual([
      'Discover',
      'Choose',
      'Start',
      'Use',
      'Share'
    ])
    const arrows = objects.filter((object) => object.kind === 'connector')
    arrows.forEach((arrow, index) => {
      expect(arrow.data.from.objectId).toBe(frames[index].id)
      expect(arrow.data.to.objectId).toBe(frames[index + 1].id)
      expect(arrow.data.route).toBe('straight')
      expect(arrow.data.endHead).toBe('arrow')
      // Placed by refreshConnectors: in the gap between the two frames.
      expect(arrow.data.from.x).toBeGreaterThan(frames[index].x + frames[index].width)
      expect(arrow.data.to.x).toBeLessThan(frames[index + 1].x)
    })
    const labels = objects.filter((object) => object.kind === 'text').slice(1)
    expect(labels.map((label) => label.text)).toEqual(['Doing', 'Thinking', 'Feeling'])
    const top = frames[0].y
    labels.forEach((label, index) => {
      const middle = label.y + label.height / 2
      expect(middle).toBeGreaterThanOrEqual(top + (index * 400) / 3)
      expect(middle).toBeLessThanOrEqual(top + ((index + 1) * 400) / 3)
      expect(label.x + label.width).toBeLessThan(frames[0].x)
    })
  })

  it.each(WHITEBOARD_TEMPLATES)('makes %s objects that pass the model’s checks', (template) => {
    const objects = build(template)
    expect(objects.length).toBeLessThanOrEqual(WHITEBOARD_LIMITS.objects)
    expect(new Set(objects.map((object) => object.id)).size).toBe(objects.length)
    for (const object of objects) {
      expect(cleanWhiteboardObject(object)).toEqual(object)
      expect(object.text.length).toBeLessThanOrEqual(WHITEBOARD_LIMITS.textChars)
    }
  })

  it.each(WHITEBOARD_TEMPLATES)('lays out %s with nothing overlapping', (template) => {
    const objects = build(template)
    const boxes = objects.filter((object) => object.kind !== 'connector')
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) {
        expect(rectsIntersect(objectRect(a), objectRect(b)), `${a.text} and ${b.text}`).toBe(false)
      }
    }
    // Each arrow sits in a gap, touching no frame.
    for (const arrow of objects.filter((object) => object.kind === 'connector')) {
      for (const box of boxes) {
        expect(rectsIntersect(objectRect(arrow), objectRect(box))).toBe(false)
      }
    }
  })
})
