import { useState, type KeyboardEvent, type RefObject } from 'react'
import { t } from '@shared/i18n'
import type { Point } from '@shared/whiteboard/geometry'
import { MIND_MAP_ROOT_SIZE, isMindmap } from '@shared/whiteboard/mind-map'
import type { WhiteboardObjectInput } from '@shared/whiteboard/model'
import { isTypingTarget } from '../../utils/dom'
import type { RestackAction } from './selection-ops'
import { isTextEditable } from './TextEditor'
import {
  isBoxTool,
  isPlacingTool,
  keysOf,
  toolForKey,
  type BoxTool,
  type PlacingTool,
  type ToolDefinition,
  type WhiteboardToolId
} from './tools'

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
}

/** Shift+arrows move a whole mind map this far, from its central idea. */
const MIND_MAP_STEP = 10

/** What the keys read and do: the editor's state and actions this render. */
export interface WhiteboardKeysActions {
  tool: WhiteboardToolId
  /** The tool bar's tools: a bare key picks one. */
  tools: readonly ToolDefinition[]
  readOnly: boolean
  list: readonly WhiteboardObjectInput[]
  present: ReadonlyMap<string, WhiteboardObjectInput>
  selected: ReadonlySet<string>
  /** The one selected object, if exactly one is. */
  single: WhiteboardObjectInput | null
  /** The objects in Tab order. */
  order: readonly WhiteboardObjectInput[]
  rootRef: RefObject<HTMLElement | null>
  boardRef: RefObject<HTMLElement | null>
  /** The Picture tool is offered. */
  hasPictures: boolean
  /** The host opens links. */
  opensLinks: boolean
  /** Make tasks is offered. */
  makesTasks: boolean
  /** The object Connect to… joins from, when there is one. */
  connectSource: WhiteboardObjectInput | null
  announce(message: string): void
  select(ids: ReadonlySet<string>, options?: { announce?: boolean }): void
  setFocusId(id: string): void
  setTool(id: WhiteboardToolId): void
  chooseTool(id: WhiteboardToolId): void
  step(direction: 'undo' | 'redo'): void
  duplicate(): void
  group(): void
  ungroup(): void
  restack(action: RestackAction): void
  openMenuFromKeys(target: Element | null): void
  moveBy(dx: number, dy: number): void
  resizeSelectedBy(dw: number, dh: number): void
  deleteSelected(): void
  startEditing(id: string, isNew: boolean): void
  placeInView(kind: PlacingTool): void
  placeBoxInView(kind: BoxTool): void
  placeMindMap(at: Point): void
  inViewMiddle(size: { width: number; height: number }): Point
  addIdea(fromId: string, how: 'child' | 'sibling'): void
  goAlongMap(id: string, arrowKey: string): void
  openPictureMenu(): void
  openLinkTool(): void
  openLink(object: WhiteboardObjectInput | null | undefined): boolean
  openMakeTasks(): void
  openConnectTo(id: string): void
  /** Ctrl+Shift+V: the paste that follows makes one note per line (D16). */
  expectLines(): void
  zoomStep(direction: 1 | -1): void
  zoomFit(): void
  zoomReset(): void
}

export interface WhiteboardKeysApi {
  /** Space is held: a press pans. */
  spaceHeld: boolean
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void
  onKeyUp(event: KeyboardEvent<HTMLDivElement>): void
}

/**
 * The whiteboard editor's keys (plan `docs/plans/whiteboards/`, D14), from the
 * shortcut table: tools, undo, the selection, mind maps (D18), zoom, and Space
 * held to pan. Keys typed into a text field are never the board's.
 */
export function useWhiteboardKeys(actions: WhiteboardKeysActions): WhiteboardKeysApi {
  const [spaceHeld, setSpaceHeld] = useState(false)
  const { tool, readOnly, list, present, selected, single, order } = actions

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(event.target)) return
    // Keys from the Connect to dialog arrive through its portal: they are not the board's.
    if (!(event.target instanceof Node) || actions.rootRef.current?.contains(event.target) !== true)
      return
    const target = event.target instanceof Element ? event.target : null
    const onBoard = target !== null && actions.boardRef.current?.contains(target) === true
    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    const handled = () => {
      event.preventDefault()
      event.stopPropagation()
    }

    if (ctrl) {
      // Ctrl+=, Ctrl+- and Ctrl+0 zoom the whole app (D26): never handled here.
      if (event.altKey) return
      if (key === 'v' && event.shiftKey) {
        // D16: the paste this key brings makes one note per line.
        actions.expectLines()
        return
      }
      if (key === 'z' && !readOnly) {
        handled()
        actions.step(event.shiftKey ? 'redo' : 'undo')
      } else if (key === 'y' && !event.shiftKey && !readOnly) {
        handled()
        actions.step('redo')
      } else if (key === 'a' && !event.shiftKey) {
        handled()
        actions.select(new Set(list.map((object) => object.id)))
      } else if (readOnly || selected.size === 0) {
        // Copy, cut and paste come as the page's clipboard events, never as keys here.
        return
      } else if (key === 'd' && !event.shiftKey) {
        handled()
        actions.duplicate()
      } else if (key === 'g') {
        handled()
        if (event.shiftKey) actions.ungroup()
        else actions.group()
      } else if (event.code === 'BracketRight' || key === ']' || key === '}') {
        handled()
        actions.restack(event.shiftKey ? 'bring-to-front' : 'bring-forward')
      } else if (event.code === 'BracketLeft' || key === '[' || key === '{') {
        handled()
        actions.restack(event.shiftKey ? 'send-to-back' : 'send-backward')
      }
      return
    }

    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      handled()
      actions.openMenuFromKeys(target)
      return
    }

    const arrow = ARROWS[event.key]
    if (event.altKey) {
      if (arrow && onBoard && selected.size > 0 && !readOnly) {
        handled()
        const distance = event.shiftKey ? 10 : 1
        actions.resizeSelectedBy(arrow[0] * distance, arrow[1] * distance)
      }
      return
    }

    if (event.key === 'Tab') {
      const id = target?.closest('[data-object-id]')?.getAttribute('data-object-id')
      const index = id ? order.findIndex((object) => object.id === id) : -1
      if (index < 0) return
      const next = order[index + (event.shiftKey ? -1 : 1)]
      // From the last (or first) object, focus leaves the board as usual.
      if (!next) return
      handled()
      actions.setFocusId(next.id)
      return
    }

    if (event.key === 'Enter' && onBoard) {
      // With Note or Text chosen, Enter places one in the middle of the view (D14);
      // otherwise it opens the focused object's words, or a card's link.
      if (isPlacingTool(tool) && !readOnly) {
        handled()
        actions.placeInView(tool)
        return
      }
      if (isBoxTool(tool) && !readOnly) {
        handled()
        actions.placeBoxInView(tool)
        return
      }
      if (tool === 'mindmap' && !readOnly) {
        handled()
        actions.placeMindMap(actions.inViewMiddle(MIND_MAP_ROOT_SIZE))
        return
      }
      const id = target?.closest('[data-object-id]')?.getAttribute('data-object-id')
      const object = id ? present.get(id) : (single ?? undefined)
      if (object?.kind === 'card') {
        if (actions.openLink(object)) handled()
        return
      }
      if (object && isTextEditable(object) && !readOnly) {
        handled()
        actions.select(new Set([object.id]), { announce: false })
        actions.startEditing(object.id, false)
      }
      return
    }

    if (event.key === ' ' && onBoard) {
      handled()
      if (!event.repeat) setSpaceHeld(true)
      return
    }

    if (
      !event.shiftKey &&
      key === keysOf('picture').toLowerCase() &&
      actions.hasPictures &&
      !readOnly
    ) {
      handled()
      actions.openPictureMenu()
      return
    }

    if (!event.shiftKey && key === keysOf('link').toLowerCase() && !readOnly) {
      handled()
      actions.openLinkTool()
      return
    }

    if (!event.shiftKey && key === keysOf('open-link').toLowerCase() && actions.opensLinks) {
      handled()
      if (!actions.openLink(single)) actions.announce(t('library:whiteboard.announce.noLink'))
      return
    }

    if (!event.shiftKey && key === keysOf('make-tasks').toLowerCase() && actions.makesTasks) {
      handled()
      actions.openMakeTasks()
      return
    }

    const source = actions.connectSource
    if (!event.shiftKey && key === keysOf('connect-to').toLowerCase() && source) {
      handled()
      actions.openConnectTo(source.id)
      return
    }

    if (!event.shiftKey) {
      const picked = toolForKey(event.key, actions.tools)
      if (picked) {
        handled()
        actions.chooseTool(picked)
        return
      }
    }

    // D18: one selected mind-map node takes Insert and the arrows for its tree.
    const node = single !== null && isMindmap(single) ? single : null
    if (event.key === 'Insert' && onBoard && node && !readOnly) {
      handled()
      actions.addIdea(node.id, 'child')
      return
    }
    if (arrow && onBoard && node) {
      if (!event.shiftKey) {
        handled()
        actions.goAlongMap(node.id, event.key)
        return
      }
      if (readOnly) return
      handled()
      // The central idea moves its map; any other idea moves its own branch.
      actions.moveBy(arrow[0] * MIND_MAP_STEP, arrow[1] * MIND_MAP_STEP)
      return
    }

    if (arrow && onBoard && selected.size > 0 && !readOnly) {
      handled()
      const distance = event.shiftKey ? 10 : 1
      actions.moveBy(arrow[0] * distance, arrow[1] * distance)
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && onBoard && !readOnly) {
      if (selected.size === 0) return
      handled()
      actions.deleteSelected()
      return
    }
    if (event.key === 'Escape' && onBoard && tool !== 'select' && tool !== 'hand') {
      handled()
      actions.setTool('select')
      return
    }
    if (event.key === 'Escape' && onBoard && selected.size > 0) {
      handled()
      actions.select(new Set())
      return
    }
    if (event.key === '+' || event.key === '=') {
      handled()
      actions.zoomStep(1)
      return
    }
    if (event.key === '-' && !event.shiftKey) {
      handled()
      actions.zoomStep(-1)
      return
    }
    if (event.shiftKey && (event.code === 'Digit1' || event.key === '!' || event.key === '1')) {
      handled()
      actions.zoomFit()
      return
    }
    if (event.shiftKey && (event.code === 'Digit0' || event.key === ')' || event.key === '0')) {
      handled()
      actions.zoomReset()
    }
  }

  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ' && spaceHeld) {
      event.stopPropagation()
      setSpaceHeld(false)
    }
  }

  return { spaceHeld, onKeyDown, onKeyUp }
}
