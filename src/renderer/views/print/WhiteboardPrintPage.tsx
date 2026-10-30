import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BRAND } from '@shared/brand'
import { formatDateTime } from '@shared/format'
import { t } from '@shared/i18n'
import { itemLinkUrl } from '@shared/item-links'
import type { ItemLinkInfo } from '@shared/ostler-api'
import type { WhiteboardPrintRoute } from '@shared/print-route'
import type { WhiteboardObject } from '@shared/whiteboard/model'
import { whiteboardItemLinks } from '@shared/whiteboard/outline'
import { exportViewBox } from '../../components/whiteboard/export'
import { WhiteboardScene } from '../../components/whiteboard/WhiteboardScene'
import { libraryItemFileUrl } from '../project-detail/library/libraryUi'
import './PrintPage.css'

/** A picture that has neither loaded nor failed by now is printed as it is. */
export const PICTURE_WAIT_MS = 20_000

function markReady(state: '1' | 'error') {
  document.documentElement.dataset.printReady = state
}

interface PrintedBoard {
  title: string
  objects: WhiteboardObject[]
  links: ReadonlyMap<string, ItemLinkInfo>
}

/** Resolves once every picture has loaded or failed, or after `timeoutMs`, whichever is first. */
function picturesSettled(
  images: readonly Element[],
  timeoutMs: number
): {
  done: Promise<void>
  stop(): void
} {
  const cleanups: Array<() => void> = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const done = new Promise<void>((resolve) => {
    let waiting = images.length
    if (waiting === 0) {
      resolve()
      return
    }
    timer = setTimeout(resolve, timeoutMs)
    for (const image of images) {
      const settle = () => {
        image.removeEventListener('load', settle)
        image.removeEventListener('error', settle)
        waiting -= 1
        if (waiting === 0) resolve()
      }
      image.addEventListener('load', settle)
      image.addEventListener('error', settle)
      cleanups.push(() => {
        image.removeEventListener('load', settle)
        image.removeEventListener('error', settle)
      })
    }
  })
  return {
    done: done.finally(() => clearTimeout(timer)),
    stop: () => {
      clearTimeout(timer)
      for (const cleanup of cleanups) cleanup()
    }
  }
}

/**
 * Print a whiteboard, or save it as a PDF (plan `docs/plans/whiteboards/`, prompt 17, D15): the
 * title and when it was printed, then the whole board at the page's width, drawn by the one
 * `WhiteboardScene`. The page is ready only once every picture has loaded or failed.
 */
export function WhiteboardPrintPage({ route }: { route: WhiteboardPrintRoute }) {
  const [board, setBoard] = useState<PrintedBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current = true
    const load = async () => {
      const result = await window.ostlerAPI.getWhiteboard(route.projectId, route.whiteboardId)
      if (!current) return
      if (!result.ok) {
        setError(result.error)
        markReady('error')
        return
      }
      const { item, objects } = result.value
      const links = new Map<string, ItemLinkInfo>()
      const refs = whiteboardItemLinks(objects)
      if (refs.length > 0) {
        // A link whose title cannot be read prints as the board shows it before it is resolved.
        const resolved = await window.ostlerAPI.resolveItemLinks(refs).catch(() => null)
        if (!current) return
        if (resolved?.ok) {
          for (const info of resolved.value) links.set(itemLinkUrl(info, BRAND.urlScheme), info)
        }
      }
      setBoard({ title: item.title, objects, links })
    }
    load().catch((failure: unknown) => {
      if (!current) return
      setError(failure instanceof Error ? failure.message : String(failure))
      markReady('error')
    })
    return () => {
      current = false
    }
  }, [route])

  // Listens before any picture can finish: a layout effect runs before the page draws.
  useLayoutEffect(() => {
    if (!board) return
    const images = Array.from(pageRef.current?.querySelectorAll('image') ?? [])
    const wait = picturesSettled(images, PICTURE_WAIT_MS)
    let cancelled = false
    let frame = 0
    void wait.done.then(() => {
      if (cancelled) return
      frame = requestAnimationFrame(() => markReady('1'))
    })
    return () => {
      cancelled = true
      wait.stop()
      cancelAnimationFrame(frame)
    }
  }, [board])

  const imageUrl = useCallback(
    (imageItemId: string) => libraryItemFileUrl(route.projectId, imageItemId, 'file'),
    [route.projectId]
  )

  if (error) return <p role="alert">{error}</p>
  if (!board) return null

  const viewBox = exportViewBox(board.objects)
  return (
    <div className="print-page whiteboard-print" ref={pageRef}>
      <header className="print-page__header">
        <h1>{board.title}</h1>
        <p>{t('library:whiteboard.print.printedAt', { date: formatDateTime(Date.now()) })}</p>
      </header>
      <div
        className="whiteboard-print__board"
        style={{ aspectRatio: `${viewBox.width} / ${viewBox.height}` }}
      >
        <WhiteboardScene
          objects={board.objects}
          viewBox={viewBox}
          width="100%"
          height="100%"
          imageUrl={imageUrl}
          links={board.links}
        />
      </div>
    </div>
  )
}
