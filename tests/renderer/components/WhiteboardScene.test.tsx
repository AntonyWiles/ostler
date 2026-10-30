// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import { itemLinkUrl } from '@shared/item-links'
import type { ItemLinkInfo } from '@shared/ostler-api'
import { taskStatusLabel } from '@shared/task-labels'
import { cleanWhiteboardObject, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import { estimateTextWidth } from '@shared/whiteboard/text-layout'
import { canvasMeasure } from '@renderer/components/whiteboard/measure'
import {
  WhiteboardScene,
  type WhiteboardSceneProps
} from '@renderer/components/whiteboard/WhiteboardScene'

/**
 * The SVG drawing of a board (docs/plans/whiteboards, prompt 04a). jsdom has
 * no canvas, so text is measured with `estimateTextWidth`: 0.55 of the font
 * size per character.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111'
const TASK = '22222222-2222-4222-8222-222222222222'
const DOC = '33333333-3333-4333-8333-333333333333'
const TASK_LINK = itemLinkUrl({ kind: 'task', projectId: PROJECT, id: TASK }, BRAND.urlScheme)
const DOC_LINK = itemLinkUrl({ kind: 'library', projectId: PROJECT, id: DOC }, BRAND.urlScheme)

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 200, height: 200, z: 0, ...fields })
}

const note = object({ id: 'note', kind: 'note', text: 'Buy milk', z: 1 })
const text = object({ id: 'text', kind: 'text', text: 'Heading', x: 300, height: 32, z: 2 })
const shape = object({
  id: 'shape',
  kind: 'shape',
  x: 600,
  z: 3,
  text: 'Start',
  data: { shape: 'diamond', fill: 'solid' }
})
const connector = object({
  id: 'connector',
  kind: 'connector',
  z: 4,
  text: 'next',
  data: {
    from: { objectId: 'note', x: 0, y: 0 },
    to: { objectId: 'shape', x: 0, y: 0 },
    startHead: 'arrow',
    endHead: 'arrow',
    dashed: true
  }
})
const pen = object({
  id: 'pen',
  kind: 'pen',
  y: 300,
  z: 5,
  data: { points: [0, 0, 10, 10, 20, 0], marker: true }
})
const image = object({ id: 'image', kind: 'image', y: 600, z: 6, data: { imageItemId: DOC } })
const card = object({ id: 'card', kind: 'card', x: 300, y: 600, z: 7, link: TASK_LINK })
const frame = object({
  id: 'frame',
  kind: 'frame',
  x: -50,
  y: -50,
  width: 1000,
  height: 1000,
  z: 99,
  text: 'Plan'
})
const root = object({ id: 'root', kind: 'mindmap', x: 0, y: 900, text: 'Idea', z: 8 })
const childA = object({
  id: 'childA',
  kind: 'mindmap',
  x: 300,
  y: 850,
  z: 9,
  colour: 'green',
  data: { parentId: 'root', order: 0 }
})
const childB = object({
  id: 'childB',
  kind: 'mindmap',
  x: 300,
  y: 950,
  z: 10,
  data: { parentId: 'root', order: 1 }
})

const ALL = [note, text, shape, connector, pen, image, card, frame, root, childA, childB]

function draw(props: Partial<WhiteboardSceneProps> = {}) {
  return render(
    <WhiteboardScene
      objects={ALL}
      viewBox={{ x: -100, y: -100, width: 1200, height: 1200 }}
      imageUrl={(id) => `data:image/png;base64,${id}`}
      measure={estimateTextWidth}
      {...props}
    />
  ).container
}

function groupIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('g[data-object-id]')].map(
    (group) => group.getAttribute('data-object-id') ?? ''
  )
}

describe('WhiteboardScene', () => {
  it('draws one <g data-object-id> for each object of every kind', () => {
    const container = draw()
    expect(new Set(groupIds(container))).toEqual(new Set(ALL.map((item) => item.id)))
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('-100 -100 1200 1200')
    expect(container.querySelector('svg > rect.wb-paper')).not.toBeNull()
  })

  it('draws in drawOrder: a frame first even with a higher z', () => {
    const ids = groupIds(draw())
    expect(ids[0]).toBe('frame')
    expect(ids.slice(1)).toEqual([
      'note',
      'text',
      'shape',
      'connector',
      'pen',
      'image',
      'card',
      'root',
      'childA',
      'childB'
    ])
  })

  it('wraps a note’s long text into several <tspan>s', () => {
    const long = object({
      id: 'long',
      kind: 'note',
      text: 'A note with enough words in it to need several lines inside its box'
    })
    const container = draw({ objects: [long] })
    const tspans = container.querySelectorAll('g[data-object-id="long"] tspan')
    expect(tspans.length).toBeGreaterThan(1)
    expect(
      container.querySelector('g[data-object-id="long"] path.wb-fill-light-yellow')
    ).not.toBeNull()
  })

  it('leaves out hidden objects', () => {
    const ids = groupIds(draw({ hiddenIds: new Set(['note']) }))
    expect(ids).not.toContain('note')
    expect(ids).toContain('text')
  })

  it('passes objectProps to each object’s <g>', () => {
    const container = draw({
      objectProps: (item) => ({ tabIndex: 0, 'aria-describedby': `d-${item.id}` })
    })
    const group = container.querySelector('g[data-object-id="shape"]')
    expect(group?.getAttribute('tabindex')).toBe('0')
    expect(group?.getAttribute('aria-describedby')).toBe('d-shape')
  })

  it('is an image named by its label, or hidden from assistive tech without one', () => {
    const named = draw({ label: 'Plan board' }).querySelector('svg')
    expect(named?.getAttribute('role')).toBe('img')
    expect(named?.getAttribute('aria-label')).toBe('Plan board')
    expect(named?.hasAttribute('aria-hidden')).toBe(false)

    const plain = draw().querySelector('svg')
    expect(plain?.getAttribute('aria-hidden')).toBe('true')
    expect(plain?.hasAttribute('role')).toBe(false)
  })

  it('shows a card’s live title and its task’s status', () => {
    const info: ItemLinkInfo = {
      kind: 'task',
      projectId: PROJECT,
      id: TASK,
      exists: true,
      title: 'Fix the header',
      status: 'blocked'
    }
    const container = draw({ objects: [card], links: new Map([[TASK_LINK, info]]) })
    const words = container.querySelector('g[data-object-id="card"]')?.textContent
    expect(words).toContain('Fix the header')
    expect(words).toContain(taskStatusLabel('blocked'))
    expect(container.querySelector('circle.wb-status-blocked')).not.toBeNull()
  })

  it('names a deleted card’s item as deleted', () => {
    const info: ItemLinkInfo = {
      kind: 'task',
      projectId: PROJECT,
      id: TASK,
      exists: false,
      title: null
    }
    const container = draw({ objects: [card], links: new Map([[TASK_LINK, info]]) })
    const words = container.querySelector('g[data-object-id="card"]')?.textContent
    expect(words).toContain(t('common:itemLinks.deletedItem'))
    expect(container.querySelector('circle[class^="wb-status"]')).toBeNull()
  })

  it('shows the kind of a card’s item while its title is unknown', () => {
    const doc = object({ id: 'doc', kind: 'card', link: DOC_LINK })
    const words = draw({ objects: [doc] }).querySelector('g[data-object-id="doc"]')?.textContent
    expect(words).toContain(t('common:itemLinks.kinds.library'))
  })

  it('draws a picture from its URL, and the placeholder when there is none', () => {
    const found = draw({ objects: [image] })
    expect(found.querySelector('image')?.getAttribute('href')).toBe(`data:image/png;base64,${DOC}`)
    expect(found.querySelector('[data-missing-picture]')).toBeNull()

    const missing = draw({ objects: [image], imageUrl: () => null })
    const group = missing.querySelector('g[data-object-id="image"]')
    expect(group?.querySelector('image')).toBeNull()
    expect(group?.querySelector('rect.wb-stroke-grey.wb-dashed')).not.toBeNull()
    expect(group?.querySelector('svg.lucide-image-off')).not.toBeNull()
    expect(group?.textContent).toBe('')

    const unset = object({ id: 'unset', kind: 'image' })
    expect(draw({ objects: [unset] }).querySelector('[data-missing-picture]')).not.toBeNull()
  })

  it('draws one branch per mind-map child, in its parent’s colour, behind the nodes', () => {
    const container = draw()
    const branches = [...container.querySelectorAll('path[data-branch-of]')]
    expect(branches.map((path) => path.getAttribute('data-branch-of')).sort()).toEqual([
      'childA',
      'childB'
    ])
    expect(branches.every((path) => path.classList.contains('wb-stroke-blue'))).toBe(true)
    const svg = container.querySelector('svg')!
    const children = [...svg.children]
    const branchGroup = children.indexOf(svg.querySelector('g.wb-branches')!)
    expect(branchGroup).toBeGreaterThan(
      children.indexOf(svg.querySelector('[data-object-id="frame"]')!)
    )
    expect(branchGroup).toBeLessThan(
      children.indexOf(svg.querySelector('[data-object-id="note"]')!)
    )
  })

  it('draws connectors with their heads, dash and label, and shapes, pens and frames in their colours', () => {
    const container = draw()
    const line = container.querySelector('g[data-object-id="connector"] path')
    expect(line?.classList.contains('wb-dashed')).toBe(true)
    expect(container.querySelectorAll('g[data-object-id="connector"] polygon')).toHaveLength(2)
    expect(container.querySelector('g[data-object-id="connector"]')?.textContent).toBe('next')
    expect(
      container.querySelector('g[data-object-id="shape"] polygon.wb-fill-black')
    ).not.toBeNull()
    expect(
      container.querySelector('g[data-object-id="shape"] text.wb-text-on-black')
    ).not.toBeNull()
    expect(container.querySelector('g[data-object-id="pen"] path.wb-marker')).not.toBeNull()
    expect(
      container.querySelector('g[data-object-id="frame"] text.wb-text-grey')?.textContent
    ).toBe('Plan')
  })

  it('draws the grid only when asked', () => {
    expect(draw().querySelector('pattern')).toBeNull()
    const container = draw({ grid: true })
    const pattern = container.querySelector('pattern')
    expect(pattern?.getAttribute('width')).toBe('10')
    expect(container.querySelector('[data-grid]')?.getAttribute('fill')).toBe(
      `url(#${pattern?.id})`
    )
  })

  it('draws the overlay last', () => {
    const svg = draw({ overlay: <rect data-overlay="" /> }).querySelector('svg')!
    expect(svg.lastElementChild?.hasAttribute('data-overlay')).toBe(true)
  })

  it('never uses <foreignObject> or a colour value in fill or stroke', () => {
    const container = draw({ grid: true, label: 'Board' })
    expect(container.querySelector('foreignObject')).toBeNull()
    for (const element of container.querySelectorAll('[fill], [stroke]')) {
      for (const name of ['fill', 'stroke']) {
        const value = element.getAttribute(name)
        if (value === null) continue
        expect(value, `${element.tagName} ${name}`).toMatch(/^(?:none|currentColor|url\(#.+\))$/)
      }
    }
  })

  it('measures with estimateTextWidth where there is no canvas', () => {
    // jsdom's canvas has no 2D context; stubbed so it does not log "Not implemented".
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(canvasMeasure('Segoe UI')).toBe(estimateTextWidth)
    getContext.mockRestore()
  })
})
