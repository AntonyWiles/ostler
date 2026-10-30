import { useCallback, useEffect, useState } from 'react'
import type { LibraryItem } from '@shared/ostler-api'
import { fitRect, objectRect, unionRect, type Rect } from '@shared/whiteboard/geometry'
import type { WhiteboardObject, WhiteboardObjectInput } from '@shared/whiteboard/model'
import { t } from '@shared/i18n'
import { Skeleton } from '../../../ui'
import { WhiteboardScene } from '../../../components/whiteboard/WhiteboardScene'
import { libraryItemFileUrl } from './libraryUi'

/** The board area the preview is fitted to, in screen pixels; CSS gives the preview its height. */
const PREVIEW_SIZE = { width: 480, height: 240 }

/** The board area that shows every object, fitted to the preview's shape (`size`, screen pixels). */
export function previewViewBox(
  objects: readonly WhiteboardObjectInput[],
  size: { width: number; height: number } = PREVIEW_SIZE
): Rect | null {
  const bounds = unionRect(objects.map(objectRect))
  if (!bounds) return null
  const view = fitRect(bounds, size)
  return {
    x: view.x,
    y: view.y,
    width: size.width / view.zoom,
    height: size.height / view.zoom
  }
}

/**
 * A whiteboard in the Library's detail: the whole board, drawn by the one
 * WhiteboardScene, read again when the item changes. It is a picture only;
 * the board is edited in the Plan (D4).
 */
export function LibraryWhiteboardPreview({ item }: { item: LibraryItem }) {
  const [objects, setObjects] = useState<WhiteboardObject[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.ostlerAPI.getWhiteboard(item.projectId, item.id).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setObjects(result.value.objects)
        setError(null)
      } else {
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [item.projectId, item.id, item.updatedAt])

  const imageUrl = useCallback(
    (imageItemId: string) => libraryItemFileUrl(item.projectId, imageItemId, 'file'),
    [item.projectId]
  )

  if (error) return <p className="ostler-library-muted">{error}</p>
  if (objects === null) return <Skeleton lines={4} />
  const viewBox = previewViewBox(objects)
  if (!viewBox) {
    return (
      <div className="ostler-library-whiteboard ostler-library-whiteboard--empty">
        <span className="ostler-library-muted">{t('library:libraryDetail.whiteboardEmpty')}</span>
      </div>
    )
  }
  return (
    <div className="ostler-library-whiteboard">
      <WhiteboardScene
        objects={objects}
        viewBox={viewBox}
        width="100%"
        height="100%"
        imageUrl={imageUrl}
        label={t('library:libraryDetail.whiteboardPreview', { title: item.title })}
      />
    </div>
  )
}
