import { useEffect, useState } from 'react'
import type { HarnessReportPicture, HarnessReportPictureLeftOut } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Button, Dialog } from '../../ui'
import { ChevronLeft, ChevronRight } from '../../ui/icons'
import './ReportPictures.css'

/** Where a stored picture is served from, read-only, by ids and its stored name. */
export function reportPictureUrl(projectId: string, sessionId: string, name: string): string {
  return `ostler-report-picture://${encodeURIComponent(projectId)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(name)}`
}

/** A picture's alternative text: its caption, or its place in the strip. */
function altText(picture: HarnessReportPicture, index: number, count: number): string {
  return picture.caption || t('agents:reportPictures.untitled', { number: index + 1, count })
}

/**
 * The pictures an agent attached to its report (N9.1): a strip of
 * thumbnails with captions, each opening full size, with the arrow keys
 * between them. Captions are the agent's text, shown as plain text.
 */
export function ReportPictures({
  projectId,
  sessionId,
  pictures,
  leftOut
}: {
  projectId: string
  sessionId: string
  pictures: HarnessReportPicture[]
  leftOut?: HarnessReportPictureLeftOut[]
}) {
  const [open, setOpen] = useState<number | null>(null)
  const count = pictures.length
  const step = (by: number) =>
    setOpen((current) => (current === null ? current : (current + by + count) % count))
  // The arrow keys move between pictures wherever focus is in the viewer.
  const viewing = open !== null
  useEffect(() => {
    if (!viewing || count < 2) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      event.preventDefault()
      setOpen((at) =>
        at === null ? at : (at + (event.key === 'ArrowRight' ? 1 : -1) + count) % count
      )
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing, count])
  const current = open === null ? null : pictures[open]

  return (
    <section className="dialog-section" aria-label={t('agents:reportPictures.title')}>
      <h3 className="dialog-section__title">{t('agents:reportPictures.title')}</h3>
      {count > 0 && (
        <ul className="report-pictures">
          {pictures.map((picture, index) => (
            <li key={picture.name}>
              <button
                type="button"
                className="report-pictures__thumb"
                aria-label={t('agents:reportPictures.open', {
                  name: altText(picture, index, count)
                })}
                onClick={() => setOpen(index)}
              >
                <img
                  src={reportPictureUrl(projectId, sessionId, picture.name)}
                  alt=""
                  loading="lazy"
                />
              </button>
              {picture.caption && (
                <span className="report-pictures__caption">{picture.caption}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {leftOut && leftOut.length > 0 && (
        <p className="dialog-muted">
          {t('agents:reportPictures.leftOut', {
            count: leftOut.length,
            reasons: [...new Set(leftOut.map((entry) => entry.reason))]
              .map((reason) => t(`agents:reportPictures.reason.${reason}`))
              .join(', ')
          })}
        </p>
      )}
      {current && open !== null && (
        <Dialog
          open
          size="full"
          onClose={() => setOpen(null)}
          title={t('agents:reportPictures.viewerTitle', { number: open + 1, count })}
          description={current.caption}
          footer={
            count > 1 ? (
              <>
                <Button variant="secondary" icon={ChevronLeft} onClick={() => step(-1)}>
                  {t('agents:reportPictures.previous')}
                </Button>
                <Button variant="secondary" icon={ChevronRight} onClick={() => step(1)}>
                  {t('agents:reportPictures.next')}
                </Button>
              </>
            ) : undefined
          }
        >
          <div className="report-pictures__viewer">
            <img
              src={reportPictureUrl(projectId, sessionId, current.name)}
              alt={altText(current, open, count)}
            />
          </div>
        </Dialog>
      )}
    </section>
  )
}
