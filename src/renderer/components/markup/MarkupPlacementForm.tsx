import { useState, type KeyboardEvent } from 'react'
import {
  MARK_KINDS,
  parsePlacement,
  type MarkKind,
  type PictureSize,
  type Placement
} from '@shared/markup'
import { Button, Select, TextField } from '../../ui'
import { Plus } from '../../ui/icons'
import { t } from '@shared/i18n'

type Placed = Extract<Placement, { ok: true }>['mark']

/**
 * Add by position (N4.2b): for a person who cannot draw, a mark from its
 * place and size typed in the picture's pixels. Not a `<form>`: the editor
 * can sit inside quick add's form, and a nested submit would reach it.
 */
export function MarkupPlacementForm({
  picture,
  onAdd
}: {
  picture: PictureSize
  onAdd: (mark: Placed) => void
}) {
  const [kind, setKind] = useState<MarkKind>('box')
  const [x, setX] = useState('0')
  const [y, setY] = useState('0')
  const [width, setWidth] = useState('100')
  const [height, setHeight] = useState('100')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const placed = parsePlacement({ kind, x, y, width, height, text }, picture)
    if (!placed.ok) {
      setError(placed.error)
      return
    }
    setError(null)
    onAdd(placed.mark)
  }
  // Enter in a field adds, as a form would.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault()
      add()
    }
  }

  return (
    <div
      className="markup-form"
      role="group"
      aria-label={t('library:markup.form.title')}
      onKeyDown={onKeyDown}
    >
      <h3 className="markup-form__title">{t('library:markup.form.title')}</h3>
      <p className="markup-form__hint">
        {t('library:markup.form.hint', { width: picture.width, height: picture.height })}
      </p>
      <Select
        label={t('library:markup.form.kind')}
        size="sm"
        value={kind}
        onChange={(event) => setKind(event.target.value as MarkKind)}
        options={MARK_KINDS.map((value) => ({
          value,
          label: t(`library:markup.kinds.${value}`)
        }))}
      />
      <div className="markup-form__numbers">
        <TextField
          label={t('library:markup.form.left')}
          inputMode="numeric"
          value={x}
          onChange={(event) => setX(event.target.value)}
        />
        <TextField
          label={t('library:markup.form.top')}
          inputMode="numeric"
          value={y}
          onChange={(event) => setY(event.target.value)}
        />
        {kind !== 'text' && (
          <>
            <TextField
              label={t('library:markup.form.width')}
              inputMode="numeric"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
            />
            <TextField
              label={t('library:markup.form.height')}
              inputMode="numeric"
              value={height}
              onChange={(event) => setHeight(event.target.value)}
            />
          </>
        )}
      </div>
      {kind === 'text' && (
        <TextField
          label={t('library:markup.form.text')}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      {error && (
        <p className="markup-form__error" role="alert">
          {error}
        </p>
      )}
      <Button size="sm" icon={Plus} onClick={add}>
        {t('library:markup.form.add')}
      </Button>
    </div>
  )
}
