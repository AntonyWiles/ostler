import { useId, useState } from 'react'
import { t } from '@shared/i18n'
import { Button, Dialog, Radio, RadioGroup, TextField } from '../../ui'

export interface ConnectCandidate {
  id: string
  /** The object's spoken name (`objectName`). */
  name: string
}

export interface ConnectToDialogProps {
  /** The selected object's spoken name: what the new line starts from. */
  fromName: string
  /** The objects that can be connected, in reading order. */
  candidates: readonly ConnectCandidate[]
  onConnect(id: string): void
  onClose(): void
}

/**
 * Connect to… (plan `docs/plans/whiteboards/`, prompt 10, D14): the keyboard
 * way to draw a line. Lists the board's other objects by their spoken names,
 * with a filter; choosing one and Connect joins the selected object to it.
 * Mount it only while it is open, so it starts empty each time.
 */
export function ConnectToDialog({
  fromName,
  candidates,
  onConnect,
  onClose
}: ConnectToDialogProps) {
  const [filter, setFilter] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const name = useId()
  const needle = filter.trim().toLocaleLowerCase()
  const shown = needle
    ? candidates.filter((candidate) => candidate.name.toLocaleLowerCase().includes(needle))
    : candidates
  const picked = shown.some((candidate) => candidate.id === chosen) ? chosen : null

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('library:whiteboard.connectTo.title')}
      description={t('library:whiteboard.connectTo.description', { name: fromName })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('library:whiteboard.connectTo.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={picked === null}
            onClick={() => {
              if (picked !== null) onConnect(picked)
            }}
          >
            {t('library:whiteboard.connectTo.connect')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('library:whiteboard.connectTo.filter')}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        data-autofocus=""
      />
      <div className="wb-connect-to__list">
        <RadioGroup legend={t('library:whiteboard.connectTo.list')}>
          {shown.length === 0 ? (
            <p>{t('library:whiteboard.connectTo.none')}</p>
          ) : (
            shown.map((candidate) => (
              <Radio
                key={candidate.id}
                name={name}
                label={candidate.name}
                checked={picked === candidate.id}
                onChange={() => setChosen(candidate.id)}
              />
            ))
          )}
        </RadioGroup>
      </div>
    </Dialog>
  )
}
