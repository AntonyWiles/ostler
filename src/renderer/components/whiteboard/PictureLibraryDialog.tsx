import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { Button, Checkbox, Dialog, Spinner } from '../../ui'
import type { PictureRef } from './picture-source'

export interface PictureLibraryDialogProps {
  /** The project's Library pictures (`WhiteboardPictureSource.listLibraryPictures`). */
  load(): Promise<PictureRef[]>
  onInsert(pictures: PictureRef[]): void
  onClose(): void
}

/**
 * Picture › From the Library… (plan `docs/plans/whiteboards/`, prompt 11):
 * the project's pictures as thumbnails with their titles; choose one or
 * several and Insert. Mount it only while it is open, so it loads afresh.
 */
export function PictureLibraryDialog({ load, onInsert, onClose }: PictureLibraryDialogProps) {
  const [pictures, setPictures] = useState<PictureRef[] | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    let current = true
    void load().then((found) => {
      if (current) setPictures(found)
    })
    return () => {
      current = false
    }
  }, [load])

  const toggle = (itemId: string, on: boolean) => {
    const next = new Set(chosen)
    if (on) next.add(itemId)
    else next.delete(itemId)
    setChosen(next)
  }

  const picked = (pictures ?? []).filter((picture) => chosen.has(picture.itemId))

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('library:whiteboard.picture.libraryTitle')}
      description={t('library:whiteboard.picture.libraryDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('library:whiteboard.picture.cancel')}
          </Button>
          <Button variant="primary" disabled={picked.length === 0} onClick={() => onInsert(picked)}>
            {t('library:whiteboard.picture.insert')}
          </Button>
        </>
      }
    >
      {pictures === null ? (
        <Spinner label={t('library:whiteboard.picture.loading')} />
      ) : pictures.length === 0 ? (
        <p>{t('library:whiteboard.picture.none')}</p>
      ) : (
        <ul className="wb-pictures" aria-label={t('library:whiteboard.picture.list')}>
          {pictures.map((picture) => (
            <li key={picture.itemId} className="wb-pictures__item">
              {picture.thumbnailUrl ? (
                <img className="wb-pictures__thumb" src={picture.thumbnailUrl} alt="" />
              ) : (
                <span className="wb-pictures__thumb" aria-hidden="true" />
              )}
              <Checkbox
                label={picture.title}
                checked={chosen.has(picture.itemId)}
                onChange={(event) => toggle(picture.itemId, event.target.checked)}
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
