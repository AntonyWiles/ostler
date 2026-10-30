import { useState } from 'react'
import type { SignOff, SignOffItem } from '@shared/ostler-api'
import { capabilitiesOf } from '@shared/share-roles'
import { formatShortDate } from '@shared/format'
import { t } from '@shared/i18n'
import { usePeople } from '../../context/PeopleContext'
import { useMyShareRole } from '../../hooks/useMyShareRole'
import { useItemSignOffs } from '../../hooks/useSignOffs'
import { Badge, Button, Combobox, ErrorText, TextArea, type ComboboxOption } from '../../ui'
import { CircleCheck, Hourglass, Undo2 } from '../../ui/icons'
import './SignOffSection.css'

type Outcome = { ok: boolean; error?: string }

/**
 * Sign-offs on one task, decision or milestone (prompt 17): the requests with their approver,
 * state, date and note. Whoever may ask, asks a named person; only that person gets Approve and
 * Send back (the note is required); the requester or an Owner can cancel a waiting one. The main
 * process checks every action; the buttons only show what it would allow.
 */
export function SignOffSection({ projectId, item }: { projectId: string; item: SignOffItem }) {
  const people = usePeople()
  const role = useMyShareRole(projectId)
  const can = capabilitiesOf(role)
  const isOwner = role === null || role === 'owner'
  const { signOffs, reload } = useItemSignOffs(item)
  const [asking, setAsking] = useState(false)
  const [approverId, setApproverId] = useState('')
  const [sendingBack, setSendingBack] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const meId = people.me?.id ?? null

  const nameOf = (personId: string | null): string => {
    const person = personId ? people.byId.get(personId) : undefined
    return person ? person.name : t('tasks:signOff.someone')
  }

  const run = async (action: () => Promise<Outcome>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? t('tasks:signOff.failed'))
      return false
    }
    await reload()
    return true
  }

  const options: ComboboxOption[] = people
    .offered(projectId)
    .map((person) => ({ value: person.id, label: person.name }))

  const ask = async () => {
    if (!approverId) return
    const done = await run(() =>
      window.ostlerAPI.requestSignOff({ item, approverPersonId: approverId })
    )
    if (done) {
      setAsking(false)
      setApproverId('')
    }
  }

  const sendBack = async (id: string) => {
    const done = await run(() => window.ostlerAPI.sendBackSignOff(id, note.trim()))
    if (done) setSendingBack(null)
  }

  const stateBadge = (signOff: SignOff) =>
    signOff.state === 'waiting' ? (
      <Badge tone="warning" icon={Hourglass}>
        {t('tasks:signOff.stateWaiting')}
      </Badge>
    ) : signOff.state === 'approved' ? (
      <Badge tone="success" icon={CircleCheck}>
        {t('tasks:signOff.stateApproved')}
      </Badge>
    ) : (
      <Badge tone="danger" icon={Undo2}>
        {t('tasks:signOff.stateSentBack')}
      </Badge>
    )

  const lineText = (signOff: SignOff): string => {
    const name = nameOf(signOff.approverPersonId)
    const answered = formatShortDate(signOff.answeredAt ?? signOff.updatedAt)
    if (signOff.state === 'approved')
      return t('tasks:signOff.signedOffBy', { name, date: answered })
    if (signOff.state === 'changes') return t('tasks:signOff.sentBackBy', { name, date: answered })
    return t('tasks:signOff.askedOf', { name, date: formatShortDate(signOff.requestedAt) })
  }

  return (
    <div className="sign-offs">
      {signOffs.length === 0 && !asking && (
        <p className="sign-offs__empty">{t('tasks:signOff.none')}</p>
      )}
      {signOffs.length > 0 && (
        <ul className="sign-offs__list">
          {signOffs.map((signOff) => {
            const mine = meId !== null && signOff.approverPersonId === meId
            const canCancel =
              signOff.state === 'waiting' &&
              (isOwner || (meId !== null && signOff.requestedByPersonId === meId))
            return (
              <li key={signOff.id} className="sign-offs__row">
                <div className="sign-offs__line">
                  {stateBadge(signOff)}
                  <span className="sign-offs__text">{lineText(signOff)}</span>
                </div>
                {signOff.note && <p className="sign-offs__note">{signOff.note}</p>}
                {signOff.state === 'waiting' && (
                  <div className="sign-offs__actions">
                    {mine && can.answerSignOffs && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busy}
                          onClick={() =>
                            void run(() => window.ostlerAPI.approveSignOff(signOff.id))
                          }
                        >
                          {t('tasks:signOff.approve')}
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy}
                          aria-expanded={sendingBack === signOff.id}
                          onClick={() => {
                            setSendingBack(sendingBack === signOff.id ? null : signOff.id)
                            setNote('')
                          }}
                        >
                          {t('tasks:signOff.sendBack')}
                        </Button>
                      </>
                    )}
                    {canCancel && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void run(() => window.ostlerAPI.cancelSignOff(signOff.id))}
                      >
                        {t('tasks:signOff.cancel')}
                      </Button>
                    )}
                  </div>
                )}
                {sendingBack === signOff.id && (
                  <div className="sign-offs__back">
                    <TextArea
                      label={t('tasks:signOff.sendBackNote')}
                      hint={t('tasks:signOff.sendBackNoteHint')}
                      value={note}
                      rows={2}
                      onChange={(event) => setNote(event.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy || note.trim() === ''}
                      onClick={() => void sendBack(signOff.id)}
                    >
                      {t('tasks:signOff.sendBackConfirm')}
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {can.requestSignOff &&
        (asking ? (
          <div className="sign-offs__ask">
            <Combobox
              label={t('tasks:signOff.askWho')}
              options={options}
              value={approverId || null}
              onChange={(next) => setApproverId(next ?? '')}
              placeholder={t('tasks:signOff.askWhoPlaceholder')}
              emptyText={t('tasks:signOff.noPeople')}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !approverId}
              onClick={() => void ask()}
            >
              {t('tasks:signOff.askConfirm')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              {t('tasks:signOff.askCancel')}
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setAsking(true)}>
            {t('tasks:signOff.ask')}
          </Button>
        ))}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  )
}
