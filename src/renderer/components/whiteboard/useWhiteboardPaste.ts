import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import { t } from '@shared/i18n'
import {
  nextZ,
  objectRect,
  rectCentre,
  rectsIntersect,
  snap,
  snapPoint,
  unionRect,
  type Point,
  type Rect
} from '@shared/whiteboard/geometry'
import {
  WHITEBOARD_DEFAULT_SIZES,
  WHITEBOARD_LIMITS,
  defaultColour,
  defaultObject,
  type CardObject,
  type ImageObject,
  type NoteObject,
  type WhiteboardObjectInput
} from '@shared/whiteboard/model'
import {
  classifyPastedText,
  copiedObjectsText,
  isPictureMime,
  type PastedText
} from '@shared/whiteboard/paste-rules'
import { isTypingTarget } from '../../utils/dom'
import {
  lineGrid,
  pictureBoxes,
  type PictureRef,
  type WhiteboardPictureSource
} from './picture-source'
import { COPY_OFFSET, copiesOf, kindWord, newId } from './selection-ops'
import { clientPoint } from './useWhiteboardPointer'
import {
  copiedWhiteboardObjects,
  countWhiteboardPaste,
  rememberCopiedObjects,
  type CopiedWhiteboardObjects
} from './whiteboard-clipboard'

/** D16: a paste this soon after Ctrl+Shift+V makes one note per line. */
const PASTE_LINES_WINDOW_MS = 1000

/** True while a drag carries files (not text or a link). */
const carriesFiles = (data: DataTransfer | null) =>
  data !== null && Array.from(data.types ?? []).includes('Files')

export interface WhiteboardPasteOptions {
  readOnly: boolean
  projectId: string | null
  pictures: WhiteboardPictureSource | undefined
  list: readonly WhiteboardObjectInput[]
  /** The board as it is now, ahead of a render: pictures arrive after an await. */
  listRef: RefObject<readonly WhiteboardObjectInput[]>
  selected: ReadonlySet<string>
  /** The board area shown, in board units. */
  viewBox: Rect
  toBoard(clientPoint: Point): Point
  rootRef: RefObject<HTMLElement | null>
  boardRef: RefObject<HTMLElement | null>
  announce(message: string): void
  /** Puts copies on the board, selected, in one commit. */
  addCopies(copies: readonly WhiteboardObjectInput[], announcement: string): void
  removalOfSelection(): Set<string>
  deleteSelected(announcement?: string): void
  setFocusId(id: string): void
}

export interface WhiteboardPasteApi {
  /** Copy and Cut from the right-click menu: the same as the keys, through Ostler's clipboard. */
  copyFromMenu(cut: boolean): void
  /** Prompt 06: a paste of objects copied from a whiteboard adds copies of them. */
  pasteCopies(held: CopiedWhiteboardObjects): void
  /** Ctrl+Shift+V: the paste that follows makes one note per line (D16). */
  expectLines(): void
  /** The top-left that puts an object of `size` in the middle of the view, snapped. */
  inViewMiddle(size: { width: number; height: number }): Point
  /** A new card (D29: 280 × 72) showing the item `url` links to, in the middle of the view. */
  cardInView(url: string): CardObject
  /**
   * Puts Library pictures on the board once `found` arrives: fitted inside
   * 480 × 480, side by side round `centre`, in one commit, selected and
   * announced (with `extra` after it, such as files left out).
   */
  addPictures(
    found: Promise<readonly PictureRef[]>,
    centre: Point,
    options?: { extra?: string; focus?: boolean }
  ): Promise<void>
  /** Files are being dragged over the board: the drop hint shows. */
  dropHint: boolean
  onDragOver(event: DragEvent<HTMLDivElement>): void
  onDragLeave(event: DragEvent<HTMLDivElement>): void
  onDrop(event: DragEvent<HTMLDivElement>): void
}

/**
 * The whiteboard editor's copy, cut and paste (D16), pictures pasted or
 * dropped on the board (prompt 11, D11) and text pasted as cards and notes.
 * Copy, cut and paste come as the window's clipboard events, taken only while
 * focus is inside the editor and not in a text field.
 */
export function useWhiteboardPaste(options: WhiteboardPasteOptions): WhiteboardPasteApi {
  const {
    readOnly,
    projectId,
    pictures,
    list,
    listRef,
    selected,
    viewBox,
    announce,
    addCopies,
    removalOfSelection,
    deleteSelected
  } = options
  const [dropHint, setDropHint] = useState(false)
  /** Until when a paste makes one note per line: set by Ctrl+Shift+V (D16). */
  const linesUntil = useRef(0)

  /**
   * Copy and Cut: the objects' text goes on the clipboard through the page's
   * own event (off screen, Ostler's own clipboard takes it from there); the
   * objects stay in this session's whiteboard clipboard.
   */
  const copyObjects = (event: ClipboardEvent, cut: boolean) => {
    if (selected.size === 0 || !event.clipboardData || (cut && readOnly)) return
    const ids = cut ? removalOfSelection() : selected
    const copied = list.filter((object) => ids.has(object.id))
    const text = copiedObjectsText(copied, kindWord)
    event.clipboardData.setData('text/plain', text)
    event.preventDefault()
    rememberCopiedObjects(copied, projectId, text)
    if (cut) deleteSelected('library:whiteboard.announce.cut')
    else announce(t('library:whiteboard.announce.copied', { count: copied.length }))
  }

  const copyFromMenu = (cut: boolean) => {
    if (selected.size === 0 || (cut && readOnly)) return
    const ids = cut ? removalOfSelection() : selected
    const copied = list.filter((object) => ids.has(object.id))
    const text = copiedObjectsText(copied, kindWord)
    void window.ostlerAPI.copyText(text)
    rememberCopiedObjects(copied, projectId, text)
    if (cut) deleteSelected('library:whiteboard.announce.cut')
    else announce(t('library:whiteboard.announce.copied', { count: copied.length }))
  }

  const pasteCopies = (held: CopiedWhiteboardObjects) => {
    // Pictures belong to their own project's Library.
    const fromElsewhere = held.projectId !== projectId
    const objects = fromElsewhere
      ? held.objects.filter((object) => object.kind !== 'image')
      : held.objects
    const leftOut = objects.length < held.objects.length
    if (objects.length === 0) {
      if (leftOut) announce(t('library:whiteboard.announce.picturesLeftOut'))
      return
    }
    const bounds = unionRect(objects.map(objectRect)) as Rect
    let dx: number
    let dy: number
    if (rectsIntersect(bounds, viewBox)) {
      // Each paste lands a step further on, so pastes do not pile up.
      const times = countWhiteboardPaste()
      dx = COPY_OFFSET * times
      dy = COPY_OFFSET * times
    } else {
      const centre = rectCentre(viewBox)
      const middle = rectCentre(bounds)
      dx = snap(centre.x - middle.x)
      dy = snap(centre.y - middle.y)
    }
    const pasted = t('library:whiteboard.announce.pasted', { count: objects.length })
    addCopies(
      copiesOf(list, objects, dx, dy),
      leftOut ? `${pasted} ${t('library:whiteboard.announce.picturesLeftOut')}` : pasted
    )
  }

  /** A new note with `text`, its top-left at `at`, linked to `link` (a web address) if given. */
  const pastedNote = (
    text: string,
    at: Point,
    z: number,
    link: string | null = null
  ): NoteObject => {
    const note = defaultObject('note', { id: newId(), x: at.x, y: at.y, z }) as NoteObject
    return { ...note, text, link }
  }

  const inViewMiddle = (size: { width: number; height: number }): Point => {
    const centre = rectCentre(viewBox)
    return snapPoint({ x: centre.x - size.width / 2, y: centre.y - size.height / 2 })
  }

  const cardInView = (url: string): CardObject => {
    const size = WHITEBOARD_DEFAULT_SIZES.card
    return {
      id: newId(),
      kind: 'card',
      ...inViewMiddle(size),
      ...size,
      z: nextZ(list),
      colour: defaultColour('card'),
      text: '',
      link: url,
      groupId: null,
      data: {}
    }
  }

  /** D16: pasted text as objects (a card, a linked note, notes per line or one note). */
  const pasteText = (pasted: Exclude<PastedText, { kind: 'objects' | 'nothing' }>) => {
    const z = nextZ(list)
    switch (pasted.kind) {
      case 'item-link':
        addCopies([cardInView(pasted.url)], t('library:whiteboard.announce.pastedCard'))
        return
      case 'web-link': {
        // An address too long to keep as a link is still kept as words.
        const link = pasted.url.length <= WHITEBOARD_LIMITS.linkChars ? pasted.url : null
        const at = inViewMiddle(WHITEBOARD_DEFAULT_SIZES.note)
        addCopies(
          [pastedNote(pasted.url.slice(0, WHITEBOARD_LIMITS.textChars), at, z, link)],
          t(
            link
              ? 'library:whiteboard.announce.pastedLink'
              : 'library:whiteboard.announce.placed.note'
          )
        )
        return
      }
      case 'lines': {
        if (pasted.lines.length === 0) return
        const corners = lineGrid(pasted.lines.length, rectCentre(viewBox))
        const notes = pasted.lines.map((line, index) => pastedNote(line, corners[index], z + index))
        const said = t('library:whiteboard.announce.pastedLines', { count: notes.length })
        addCopies(
          notes,
          pasted.dropped > 0
            ? `${said} ${t('library:whiteboard.announce.linesLeftOut', { count: pasted.dropped })}`
            : said
        )
        return
      }
      case 'text':
        addCopies(
          [pastedNote(pasted.text, inViewMiddle(WHITEBOARD_DEFAULT_SIZES.note), z)],
          t('library:whiteboard.announce.placed.note')
        )
    }
  }

  /**
   * Paste (D16): pictures become image objects through the Library; copied
   * objects paste as objects; other text becomes a card, a linked note, one
   * note, or after Ctrl+Shift+V one note per line. Every paste that adds
   * objects is one commit, selected and announced.
   */
  const paste = (event: ClipboardEvent) => {
    const asLines = Date.now() <= linesUntil.current
    linesUntil.current = 0
    const data = event.clipboardData
    if (readOnly || !data) return
    const files = Array.from(data.files ?? [])
    const pictureFiles = files.filter((file) => isPictureMime(file.type))
    if (pictures && pictureFiles.length > 0) {
      event.preventDefault()
      void addPictures(pictures.importFiles(pictureFiles), rectCentre(viewBox))
      return
    }
    const held = copiedWhiteboardObjects()
    const pasted = classifyPastedText(data.getData('text/plain') ?? '', {
      asLines,
      copiedText: held?.text ?? null
    })
    if (pasted.kind === 'nothing') return
    event.preventDefault()
    if (pasted.kind === 'objects') {
      if (held) pasteCopies(held)
      return
    }
    pasteText(pasted)
  }

  const addPictures = async (
    found: Promise<readonly PictureRef[]>,
    centre: Point,
    pictureOptions: { extra?: string; focus?: boolean } = {}
  ) => {
    const refs = await found
    const extra = pictureOptions.extra
    if (refs.length === 0) {
      if (extra) announce(extra)
      return
    }
    const base = nextZ(listRef.current)
    const boxes = pictureBoxes(refs, centre)
    const added: ImageObject[] = refs.map((ref, index) => ({
      id: newId(),
      kind: 'image',
      ...boxes[index],
      z: base + index,
      colour: defaultColour('image'),
      text: '',
      link: null,
      groupId: null,
      data: { imageItemId: ref.itemId }
    }))
    const said = t('library:whiteboard.announce.picturesAdded', { count: added.length })
    addCopies(added, extra ? `${said} ${extra}` : said)
    if (pictureOptions.focus) options.setFocusId(added[0].id)
  }

  /** Files dragged over the board: only pictures can go on it, and only while it can change. */
  const canDrop = (event: DragEvent<HTMLDivElement>) =>
    pictures !== undefined && !readOnly && carriesFiles(event.dataTransfer)

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canDrop(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!dropHint) setDropHint(true)
  }

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && options.boardRef.current?.contains(next)) return
    setDropHint(false)
  }

  /** A drop: the pictures go on the board where they were dropped; other files are named. */
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDropHint(false)
    if (!pictures || !canDrop(event)) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files ?? [])
    const pictureFiles = files.filter((file) => isPictureMime(file.type))
    const others = files.length - pictureFiles.length
    const extra =
      others > 0 ? t('library:whiteboard.announce.notPictures', { count: others }) : undefined
    if (pictureFiles.length === 0) {
      if (extra) announce(extra)
      return
    }
    const at = options.toBoard(clientPoint(event))
    void addPictures(pictures.importFiles(pictureFiles), at, { extra })
  }

  /** Read by the window's clipboard listeners, which are added once. */
  const clipboardHandlers = useRef({ copy: copyObjects, paste })
  useEffect(() => {
    clipboardHandlers.current = { copy: copyObjects, paste }
  })
  const { rootRef } = options
  useEffect(() => {
    // Only while focus is inside the editor and not in a text field.
    const ours = () => {
      const active = document.activeElement
      return (
        active !== null && rootRef.current?.contains(active) === true && !isTypingTarget(active)
      )
    }
    const onCopy = (event: ClipboardEvent) => {
      if (ours()) clipboardHandlers.current.copy(event, false)
    }
    const onCut = (event: ClipboardEvent) => {
      if (ours()) clipboardHandlers.current.copy(event, true)
    }
    const onPaste = (event: ClipboardEvent) => {
      if (ours()) clipboardHandlers.current.paste(event)
    }
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCut)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCut)
      window.removeEventListener('paste', onPaste)
    }
  }, [rootRef])

  return {
    copyFromMenu,
    pasteCopies,
    expectLines: () => {
      // Its default may already be prevented (off screen the preload pastes itself, after a
      // round trip to main), so it is remembered whatever happens to the key.
      linesUntil.current = Date.now() + PASTE_LINES_WINDOW_MS
    },
    inViewMiddle,
    cardInView,
    addPictures,
    dropHint,
    onDragOver,
    onDragLeave,
    onDrop
  }
}
