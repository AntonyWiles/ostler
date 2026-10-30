import { useMemo, useState } from 'react'
import { BRAND } from '@shared/brand'
import { extractItemLinks } from '@shared/item-links'
import { t } from '@shared/i18n'
import { Button } from '../../ui'
import { Image as ImageIcon } from '../../ui/icons'
import { libraryItemFileUrl } from '../project-detail/library/libraryUi'
import { AttachmentPreview } from './AttachmentPreview'
import './DescriptionPictures.css'

const KEY = 'ostler.descriptionPicturesShown'

function readShown(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false'
  } catch {
    return true
  }
}

/**
 * The pictures a description holds, as thumbnails under the editor, so a
 * picture pasted into it can be seen while writing (the text itself shows only
 * its link). A thumbnail opens a popup preview and changes nothing in the
 * description; "Hide pictures" keeps the thumbnails out of the editor, and the
 * choice is remembered on this computer.
 */
export function DescriptionPictures({
  projectId,
  description
}: {
  projectId: string
  description: string
}) {
  const [shown, setShown] = useState(readShown)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const pictures = useMemo(
    () => extractItemLinks(description, BRAND.urlScheme).filter((ref) => ref.kind === 'library'),
    [description]
  )
  if (pictures.length === 0) return null

  const toggle = () => {
    const next = !shown
    setShown(next)
    try {
      localStorage.setItem(KEY, next ? 'true' : 'false')
    } catch {
      // A convenience only: the choice lasts until the drawer closes.
    }
  }

  return (
    <div className="task-description-pictures">
      <Button size="sm" variant="ghost" icon={ImageIcon} onClick={toggle} aria-pressed={shown}>
        {shown ? t('tasks:attachFiles.hidePictures') : t('tasks:attachFiles.showPictures')}
      </Button>
      {shown &&
        pictures.map((picture) => (
          <button
            key={picture.id}
            type="button"
            className="task-description-pictures__button"
            title={t('tasks:attachFiles.preview')}
            onClick={() => setPreviewId(picture.id)}
          >
            <img
              className="task-description-pictures__image"
              src={libraryItemFileUrl(picture.projectId, picture.id, 'thumb')}
              alt={t('tasks:attachFiles.preview')}
            />
          </button>
        ))}
      {previewId && (
        <AttachmentPreview
          projectId={projectId}
          itemId={previewId}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  )
}
