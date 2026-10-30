import { useId, useMemo, useState } from 'react'
import { t } from '@shared/i18n'
import { Button, Dialog, InlineAlert, TextField } from '../../../ui'
import { WhiteboardScene } from '../../../components/whiteboard/WhiteboardScene'
import { canvasMeasure } from '../../../components/whiteboard/measure'
import {
  WHITEBOARD_TEMPLATES,
  buildTemplate,
  type WhiteboardTemplate
} from '../../../components/whiteboard/templates'
import { previewViewBox } from '../../project-detail/library/LibraryWhiteboardPreview'
import './NewWhiteboardDialog.css'

/** The board area a template's preview is fitted to, in screen pixels; CSS sizes the card. */
const PREVIEW_SIZE = { width: 240, height: 140 }

export interface NewWhiteboardDialogProps {
  projectId: string
  /** Brainstorm's central idea and the kick-off's title. */
  projectName: string
  /** The title the field starts with ("Whiteboard N", from `nextWhiteboardTitle`). */
  defaultTitle: string
  /** The new board was made: its id. */
  onCreated(whiteboardId: string): void
  onCancel(): void
}

/**
 * New whiteboard (D19): a title and a template, each previewed as the board it
 * makes. The one way a whiteboard is made, from the Plan and from the Library.
 * Mount it to open it.
 */
export function NewWhiteboardDialog({
  projectId,
  projectName,
  defaultTitle,
  onCreated,
  onCancel
}: NewWhiteboardDialogProps) {
  const [title, setTitle] = useState(defaultTitle)
  const [template, setTemplate] = useState<WhiteboardTemplate>('blank')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const measure = useMemo(() => canvasMeasure(), [])
  const groupName = useId()

  // Each preview is built the same way as the board, with ids that only it uses.
  const previews = useMemo(
    () =>
      WHITEBOARD_TEMPLATES.map((id) => {
        let count = 0
        const objects = buildTemplate(id, {
          projectName,
          newId: () => `preview-${++count}`,
          measure
        })
        return { id, objects, viewBox: previewViewBox(objects, PREVIEW_SIZE) }
      }),
    [projectName, measure]
  )

  const submit = async () => {
    if (busy || !title.trim()) return
    setBusy(true)
    setError(null)
    const objects = buildTemplate(template, {
      projectName,
      newId: () => crypto.randomUUID(),
      measure
    })
    const result = await window.ostlerAPI.createWhiteboard(projectId, {
      title: title.trim(),
      objects
    })
    setBusy(false)
    if (result.ok) onCreated(result.value.item.id)
    else setError(result.error)
  }

  /** Import a whiteboard file (prompt 16, D15): main's open dialog; the new board opens. */
  const importFile = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await window.ostlerAPI.importWhiteboardFile(projectId)
    setBusy(false)
    if (!result.ok) setError(result.error)
    else if (result.value) onCreated(result.value.id)
  }

  return (
    <Dialog
      open
      size="lg"
      title={t('library:whiteboard.newDialog.title')}
      onClose={onCancel}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={() => void importFile()} disabled={busy}>
            {t('library:whiteboard.newDialog.import')}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('library:whiteboard.newDialog.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!title.trim()}
            onClick={() => void submit()}
          >
            {t('library:whiteboard.newDialog.create')}
          </Button>
        </>
      }
    >
      <form
        className="new-whiteboard"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('library:whiteboard.newDialog.titleLabel')}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            setError(null)
          }}
          data-autofocus
        />
        <fieldset className="new-whiteboard__templates">
          <legend className="new-whiteboard__legend">
            {t('library:whiteboard.newDialog.templateLegend')}
          </legend>
          <div className="new-whiteboard__list">
            {previews.map((preview) => {
              const nameId = `${groupName}-${preview.id}-name`
              const descriptionId = `${groupName}-${preview.id}-description`
              const chosen = template === preview.id
              return (
                <label
                  key={preview.id}
                  className={`new-whiteboard__template${chosen ? ' is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={preview.id}
                    checked={chosen}
                    disabled={busy}
                    aria-labelledby={nameId}
                    aria-describedby={descriptionId}
                    onChange={() => setTemplate(preview.id)}
                  />
                  <span className="new-whiteboard__preview">
                    {preview.viewBox && (
                      <WhiteboardScene
                        objects={preview.objects}
                        viewBox={preview.viewBox}
                        width="100%"
                        height="100%"
                        imageUrl={() => null}
                        measure={measure}
                      />
                    )}
                  </span>
                  <span id={nameId} className="new-whiteboard__name">
                    {t(`library:whiteboard.templates.${preview.id}.name`)}
                  </span>
                  <span id={descriptionId} className="new-whiteboard__description">
                    {t(`library:whiteboard.templates.${preview.id}.description`)}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      </form>
    </Dialog>
  )
}
