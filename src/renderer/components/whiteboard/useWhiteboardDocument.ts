import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import { itemLinkUrl } from '@shared/item-links'
import type {
  ItemLinkInfo,
  ItemLinkRef,
  LibraryItem,
  WhiteboardObjectInput,
  WhiteboardSaveInput
} from '@shared/ostler-api'
import { diffObjectMaps, objectList, type ObjectMap } from '@shared/whiteboard/history'
import { objectLinkTarget, sameWhiteboardObject } from '@shared/whiteboard/model'
import { whiteboardItemLinks } from '@shared/whiteboard/outline'
import { useFlushOnQuit } from '../../shell/flush-on-quit'

/** D12: a change is saved this long after the last one. */
export const WHITEBOARD_SAVE_DELAY_MS = 800
/** Linked items are resolved again this long after the last planning or Library change. */
export const LINK_REFRESH_DELAY_MS = 300

export type WhiteboardDocumentStatus = 'loading' | 'ready' | 'missing' | 'error'
export type WhiteboardSaveState = 'saved' | 'saving' | 'unsaved' | 'failed'

export interface WhiteboardDocumentState {
  status: WhiteboardDocumentStatus
  item: LibraryItem | null
  /** The objects the editor starts from; replaced (with a new `version`) on load and merge. */
  objects: readonly WhiteboardObjectInput[]
  /** A new value tells the editor to show `objects` and clear its undo (D13). */
  version: number
  /** On a Viewer's PC (D9) and for an archived whiteboard. */
  readOnly: boolean
  saveState: WhiteboardSaveState
  /** Why the load or the last save failed. */
  error: string | null
  /** The editor's every new state; saved `WHITEBOARD_SAVE_DELAY_MS` after the last. */
  onChange(present: ObjectMap): void
  /** Saves what is waiting now; resolves once it is saved or has failed. */
  flush(): Promise<void>
  /** The board's linked items, keyed by link URL. */
  links: ReadonlyMap<string, ItemLinkInfo>
  /** The Library titles of the board's pictures, by image item id (prompt 11). */
  pictureTitles: ReadonlyMap<string, string>
}

const NO_LINKS: ReadonlyMap<string, ItemLinkInfo> = new Map()
const NO_TITLES: ReadonlyMap<string, string> = new Map()
const EMPTY: ObjectMap = new Map()

const isEmpty = (save: WhiteboardSaveInput) =>
  save.upserts.length === 0 && save.deletes.length === 0

/** Two states of one object, either possibly absent, are the same. */
function same(a: WhiteboardObjectInput | undefined, b: WhiteboardObjectInput | undefined) {
  if (a === undefined || b === undefined) return a === b
  return a === b || sameWhiteboardObject(a, b)
}

/** The board's item links as one string: the links set changes when it does. */
function linkKey(objects: Iterable<WhiteboardObjectInput>): string {
  const found = new Set<string>()
  for (const object of objects) if (object.link && objectLinkTarget(object)) found.add(object.link)
  return [...found].sort().join('\n')
}

/** The board's pictures (Library image item ids) as one string: changes when the set does. */
function pictureKey(objects: Iterable<WhiteboardObjectInput>): string {
  const found = new Set<string>()
  for (const object of objects) {
    if (object.kind === 'image' && object.data.imageItemId) found.add(object.data.imageItemId)
  }
  return [...found].sort().join('\n')
}

/**
 * One open whiteboard (plan `docs/plans/whiteboards/`, prompt 07): loads it,
 * saves the editor's changes 800 ms after the last (D12), one save at a time,
 * and merges changes made elsewhere (D13): an object changed elsewhere is
 * taken unless the person changed it here since the last save.
 */
export function useWhiteboardDocument(
  projectId: string,
  whiteboardId: string
): WhiteboardDocumentState {
  const [status, setStatus] = useState<WhiteboardDocumentStatus>('loading')
  const [item, setItem] = useState<LibraryItem | null>(null)
  const [objects, setObjects] = useState<readonly WhiteboardObjectInput[]>([])
  const [version, setVersion] = useState(0)
  const [viewer, setViewer] = useState(false)
  const [saveState, setSaveState] = useState<WhiteboardSaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  const [refs, setRefs] = useState<ItemLinkRef[]>([])
  const [linksKey, setLinksKey] = useState('')
  const [linkRefresh, setLinkRefresh] = useState(0)
  /** Counts the planning and Library changes that may have changed a linked item. */
  const [linkTick, setLinkTick] = useState(0)
  const [links, setLinks] = useState<ReadonlyMap<string, ItemLinkInfo>>(NO_LINKS)
  const [picturesKey, setPicturesKey] = useState('')
  const [pictureTitles, setPictureTitles] = useState<ReadonlyMap<string, string>>(NO_TITLES)

  /** What the store holds, as far as this window knows. */
  const lastSaved = useRef<ObjectMap>(EMPTY)
  /** The newest state: the editor's, with merges taken in. */
  const latest = useRef<ObjectMap>(EMPTY)
  const statusRef = useRef<WhiteboardDocumentStatus>('loading')
  const readOnlyRef = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const queued = useRef(false)
  const live = useRef(true)

  const readOnly = viewer || Boolean(item?.archivedAt)
  readOnlyRef.current = readOnly

  const setStatusBoth = (next: WhiteboardDocumentStatus) => {
    statusRef.current = next
    setStatus(next)
  }

  const linksKeyRef = useRef('')
  const noteLinks = useCallback((map: ObjectMap) => {
    setPicturesKey(pictureKey(map.values()))
    const key = linkKey(map.values())
    if (key === linksKeyRef.current) return
    linksKeyRef.current = key
    setRefs(whiteboardItemLinks([...map.values()]))
    setLinksKey(key)
  }, [])

  /** Shows a freshly loaded board: everything this window knew is replaced. */
  const show = useCallback(
    (loaded: { item: LibraryItem; objects: WhiteboardObjectInput[] }) => {
      const map: ObjectMap = new Map(loaded.objects.map((object) => [object.id, object]))
      lastSaved.current = map
      latest.current = map
      setItem(loaded.item)
      setObjects(objectList(map))
      setVersion((v) => v + 1)
      setSaveState('saved')
      setError(null)
      noteLinks(map)
      setStatusBoth('ready')
    },
    [noteLinks]
  )

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  /** Sends what differs from `lastSaved`, again while changes arrive during a save. */
  const save = useCallback((): Promise<void> => {
    clearTimer()
    if (inFlight.current) {
      queued.current = true
      return inFlight.current
    }
    const run = (async () => {
      do {
        queued.current = false
        const sent = diffObjectMaps(lastSaved.current, latest.current)
        if (isEmpty(sent)) break
        if (live.current) setSaveState('saving')
        const result = await window.ostlerAPI.saveWhiteboard(projectId, whiteboardId, sent)
        if (!result.ok) {
          queued.current = false
          if (live.current) {
            setSaveState('failed')
            setError(result.error)
          }
          return
        }
        // What was sent is now stored; merges since may have moved other objects on.
        const next = new Map(lastSaved.current)
        for (const object of sent.upserts) next.set(object.id, object)
        for (const id of sent.deletes) next.delete(id)
        lastSaved.current = next
        if (live.current) setItem(result.value.item)
      } while (queued.current)
      if (live.current) {
        setError(null)
        setSaveState(timer.current === null ? 'saved' : 'unsaved')
      }
    })().finally(() => {
      inFlight.current = null
    })
    inFlight.current = run
    return run
  }, [projectId, whiteboardId])

  const onChange = useCallback(
    (present: ObjectMap) => {
      if (readOnlyRef.current || statusRef.current !== 'ready') return
      latest.current = present
      noteLinks(present)
      setSaveState((state) => (state === 'saving' || state === 'failed' ? state : 'unsaved'))
      clearTimer()
      timer.current = setTimeout(() => {
        timer.current = null
        void save()
      }, WHITEBOARD_SAVE_DELAY_MS)
    },
    [noteLinks, save]
  )

  const flush = useCallback(() => save(), [save])
  useFlushOnQuit(flush)

  /** A change elsewhere (D13): takes what changed there unless it changed here too. */
  const merge = useCallback(
    (incoming: { item: LibraryItem; objects: WhiteboardObjectInput[] }) => {
      setItem(incoming.item)
      const theirs = new Map(incoming.objects.map((object) => [object.id, object]))
      const base = new Map(lastSaved.current)
      const mine = new Map(latest.current)
      let took = false
      for (const id of new Set([...theirs.keys(), ...base.keys()])) {
        const there = theirs.get(id)
        const before = base.get(id)
        if (same(there, before)) continue
        if (same(mine.get(id), before)) {
          if (there === undefined) mine.delete(id)
          else mine.set(id, there)
          took = true
        }
        // Either way the store now holds theirs; a change kept here is saved over it.
        if (there === undefined) base.delete(id)
        else base.set(id, there)
      }
      lastSaved.current = base
      if (!took) return
      latest.current = mine
      setObjects(objectList(mine))
      setVersion((v) => v + 1)
      noteLinks(mine)
    },
    [noteLinks]
  )

  // Load, and follow the Library: a change there may be this board's.
  useEffect(() => {
    live.current = true
    let active = true
    let request = 0
    lastSaved.current = EMPTY
    latest.current = EMPTY
    setStatusBoth('loading')
    const fetchBoard = (first: boolean) => {
      const mine = ++request
      void window.ostlerAPI.getWhiteboard(projectId, whiteboardId).then((result) => {
        if (!active || mine !== request) return
        if (!result.ok) {
          if (result.error === t('errors:whiteboard.notAWhiteboard')) setStatusBoth('missing')
          else if (first) {
            setError(result.error)
            setStatusBoth('error')
          }
          return
        }
        if (statusRef.current === 'ready') merge(result.value)
        else show(result.value)
        setLinkRefresh((n) => n + 1)
      })
    }
    fetchBoard(true)
    const stop = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.projectId === projectId && update.field === 'library') fetchBoard(false)
    })
    return () => {
      stop()
      active = false
      live.current = false
      void save()
    }
  }, [projectId, whiteboardId, merge, show, save])

  // A Viewer's PC only views (D9).
  useEffect(() => {
    let current = true
    const load = () =>
      void window.ostlerAPI.getShareState(projectId).then((result) => {
        if (current) setViewer(result.ok && result.value?.myRole === 'viewer')
      })
    load()
    const stop = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'sharing' && update.projectId === projectId) load()
    })
    return () => {
      current = false
      stop()
    }
  }, [projectId])

  // A task, milestone, decision or Library item may change anywhere (prompt 12): the
  // titles and statuses are resolved again 300 ms after the last such change.
  useEffect(() => {
    let wait: ReturnType<typeof setTimeout> | null = null
    const stop = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.projectId !== projectId) return
      if (update.field !== 'planning' && update.field !== 'library') return
      if (wait !== null) clearTimeout(wait)
      wait = setTimeout(() => {
        wait = null
        setLinkTick((n) => n + 1)
      }, LINK_REFRESH_DELAY_MS)
    })
    return () => {
      stop()
      if (wait !== null) clearTimeout(wait)
    }
  }, [projectId])

  // The linked items' live titles: after load, when the set changes, and after a change elsewhere.
  useEffect(() => {
    if (refs.length === 0) {
      setLinks(NO_LINKS)
      return
    }
    let current = true
    void window.ostlerAPI.resolveItemLinks(refs).then((result) => {
      if (!current || !result.ok) return
      setLinks(new Map(result.value.map((info) => [itemLinkUrl(info, BRAND.urlScheme), info])))
    })
    return () => {
      current = false
    }
    // `linksKey` stands for `refs`.
  }, [linksKey, linkRefresh, linkTick])

  // The pictures' Library titles, for their spoken names: as for links.
  useEffect(() => {
    if (picturesKey === '') {
      setPictureTitles(NO_TITLES)
      return
    }
    const wanted = new Set(picturesKey.split('\n'))
    let current = true
    void window.ostlerAPI
      .listLibraryItems(projectId, { kind: 'image', includeArchived: true })
      .then((result) => {
        if (!current || !result.ok) return
        setPictureTitles(
          new Map(
            result.value
              .filter((found) => wanted.has(found.id))
              .map((found) => [found.id, found.title])
          )
        )
      })
    return () => {
      current = false
    }
  }, [projectId, picturesKey, linkRefresh])

  return useMemo(
    () => ({
      status,
      item,
      objects,
      version,
      readOnly,
      saveState,
      error,
      onChange,
      flush,
      links,
      pictureTitles
    }),
    [
      status,
      item,
      objects,
      version,
      readOnly,
      saveState,
      error,
      onChange,
      flush,
      links,
      pictureTitles
    ]
  )
}
