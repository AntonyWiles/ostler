import { useEffect, useState } from 'react'
import type { Person, PersonUsage } from '@shared/ostler-api'
import { formatList } from '@shared/format'
import { t } from '@shared/i18n'
import { usePeople } from '../../../context/PeopleContext'
import { useProjectList } from '../../../context/OstlerContext'
import { Button, Dialog, InlineAlert, Radio, RadioGroup, Select, Spinner } from '../../../ui'

/**
 * Deleting a person for good. With nothing of theirs, it only asks. With
 * tasks, it says where and offers what happens to them: someone else takes
 * them (someone who can be given work in every one of those projects), or
 * they are left unassigned. Me and members of a shared project cannot be
 * deleted here, and the dialog says why.
 */
export function DeletePersonDialog({
  person,
  onClose,
  onDeleted
}: {
  person: Person
  onClose: () => void
  onDeleted: () => void
}) {
  const people = usePeople()
  const projects = useProjectList()
  const [usage, setUsage] = useState<PersonUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'give' | 'unassign'>('give')
  const [taker, setTaker] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.ostlerAPI.getPersonUsage(person.id).then((result) => {
      if (result.ok) setUsage(result.value)
      else setError(result.error)
    })
  }, [person.id])

  // Who can take every task: one project's own people only when all of it is in that project.
  const inProjects = [...new Set(usage?.projects.map((entry) => entry.projectId) ?? [])]
  const scope = inProjects.length === 1 ? inProjects[0] : null
  const takers = people.offered(scope).filter((candidate) => candidate.id !== person.id)
  const chosen = takers.some((candidate) => candidate.id === taker)
    ? taker
    : (takers.find((candidate) => candidate.isMe) ?? takers[0])?.id

  const taskCount = usage?.projects.reduce((sum, entry) => sum + entry.tasks, 0) ?? 0
  const hasWork = taskCount > 0 || (usage?.rules ?? 0) > 0
  const blocked = usage !== null && (usage.isMe || usage.sharedMember)
  const giving = hasWork && mode === 'give' && chosen !== undefined

  const remove = async () => {
    setBusy(true)
    const result = await window.ostlerAPI.deletePerson(person.id, {
      giveTasksTo: giving ? chosen : null
    })
    setBusy(false)
    if (result.ok) onDeleted()
    else setError(result.error)
  }

  const projectName = (projectId: string) =>
    projects.find((project) => project.id === projectId)?.name ??
    t('settings:deletePersonDialog.removedProject')

  return (
    <Dialog
      open
      role="alertdialog"
      size="sm"
      onClose={onClose}
      canDismiss={!busy}
      title={t('settings:deletePersonDialog.title', { personName: person.name })}
      footer={
        blocked ? (
          <Button onClick={onClose}>{t('settings:deletePersonDialog.close')}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {t('settings:deletePersonDialog.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={usage === null || busy}
              onClick={() => void remove()}
            >
              {t('settings:deletePersonDialog.delete')}
            </Button>
          </>
        )
      }
    >
      <div className="ostler-settings-delete-person">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {usage === null ? (
          !error && (
            <Spinner
              label={t('settings:deletePersonDialog.checking', { personName: person.name })}
            />
          )
        ) : usage.isMe ? (
          <p className="ostler-settings-text">{t('settings:deletePersonDialog.isMe')}</p>
        ) : usage.sharedMember ? (
          <p className="ostler-settings-text">
            {t('settings:deletePersonDialog.sharedMember', { personName: person.name })}
          </p>
        ) : (
          <>
            {taskCount > 0 && (
              <p className="ostler-settings-text">
                {t('settings:deletePersonDialog.tasksIn', {
                  personName: person.name,
                  count: taskCount,
                  projects: formatList(usage.projects.map((entry) => projectName(entry.projectId)))
                })}
              </p>
            )}
            {usage.rules > 0 && (
              <p className="ostler-settings-text">
                {t('settings:deletePersonDialog.rulesNameThem', { count: usage.rules })}
              </p>
            )}
            {hasWork && (
              <RadioGroup legend={t('settings:deletePersonDialog.whatHappens')}>
                <Radio
                  name={`delete-person-${person.id}`}
                  label={t('settings:deletePersonDialog.giveTo')}
                  checked={mode === 'give' && takers.length > 0}
                  disabled={takers.length === 0}
                  hint={
                    takers.length === 0 ? t('settings:deletePersonDialog.nobodyElse') : undefined
                  }
                  onChange={() => setMode('give')}
                />
                {mode === 'give' && takers.length > 0 && (
                  <Select
                    label={t('settings:deletePersonDialog.personToGiveTo')}
                    hideLabel
                    value={chosen}
                    onChange={(event) => setTaker(event.target.value)}
                    options={takers.map((candidate) => ({
                      value: candidate.id,
                      label: candidate.isMe
                        ? t('settings:deletePersonDialog.you', { personName: candidate.name })
                        : candidate.name
                    }))}
                  />
                )}
                <Radio
                  name={`delete-person-${person.id}`}
                  label={t('settings:deletePersonDialog.leaveUnassigned')}
                  hint={
                    usage.rules > 0 ? t('settings:deletePersonDialog.rulesTurnedOff') : undefined
                  }
                  checked={mode === 'unassign' || takers.length === 0}
                  onChange={() => setMode('unassign')}
                />
              </RadioGroup>
            )}
            <p className="ostler-settings-hint">{t('settings:deletePersonDialog.cantBeUndone')}</p>
          </>
        )}
      </div>
    </Dialog>
  )
}
