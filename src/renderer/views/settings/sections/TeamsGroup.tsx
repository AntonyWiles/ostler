import { useState } from 'react'
import { MAX_TEAM_NAME, type Person, type Team } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { PROJECT_COLORS } from '@shared/project-colors'
import { usePeople } from '../../../context/PeopleContext'
import { useTeams } from '../../../hooks/useTeams'
import { ProjectColorPicker } from '../../../components/ProjectColorPicker'
import { Badge, Button, Checkbox, Dialog, Select, TextField, useToast } from '../../../ui'
import { SettingsGroup, useSettings } from '../settings-form'
import '../../SettingsView.css'
import './TeamsGroup.css'

/** The Select value for "no lead". */
const NO_LEAD = ''

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string }
type Changed = <T>(result: Outcome<T>) => Promise<T | null>

/**
 * Settings › People › Teams (team-leaders plan, D1): named groups of people from the address
 * book, each with a colour and an optional lead. A team grants nothing, is not shared with a
 * project's members, and follows the person to their own other devices. Archiving is
 * reversible, so it happens at once and offers undo; deleting asks first and leaves the
 * people alone.
 */
export function TeamsGroup() {
  const { markSaved, setError } = useSettings()
  const people = usePeople()
  const teams = useTeams()
  const { toastUndo } = useToast()
  const [editing, setEditing] = useState<Team | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Team | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const archivedCount = teams.all.length - teams.active.length
  const listed = showArchived ? teams.all : teams.active

  const changed: Changed = async (result) => {
    if (!result.ok) {
      setError(result.error)
      return null
    }
    setError(null)
    await teams.refresh()
    markSaved()
    return result.value
  }

  const archive = async (team: Team) => {
    if (!(await changed(await window.ostlerAPI.archiveTeam(team.id)))) return
    toastUndo(t('settings:teams.archived', { name: team.name }), async () => {
      await changed(await window.ostlerAPI.restoreTeam(team.id))
    })
  }

  const leadName = (team: Team) =>
    team.leadPersonId ? (people.byId.get(team.leadPersonId)?.name ?? '') : ''

  return (
    <SettingsGroup
      id="teams"
      description={t('settings:teams.description')}
      actions={
        <Button size="sm" onClick={() => setEditing('new')}>
          {t('settings:teams.new')}
        </Button>
      }
    >
      {listed.length > 0 ? (
        <ul className="ostler-settings-people" aria-label={t('settings:teams.title')}>
          {listed.map((team) => (
            <li key={team.id} className="ostler-settings-person">
              <span
                className="ostler-teams__swatch"
                style={{ backgroundColor: team.color }}
                aria-hidden="true"
              />
              <span className="ostler-settings-person-name">
                {team.name}
                {team.archivedAt !== null && <Badge>{t('settings:teams.archivedBadge')}</Badge>}
                <span className="ostler-settings-person-capacity">
                  {leadName(team)
                    ? t('settings:teams.summaryWithLead', {
                        count: team.memberIds.length,
                        lead: leadName(team)
                      })
                    : t('settings:teams.summary', { count: team.memberIds.length })}
                </span>
              </span>
              <div className="ostler-settings-person-actions">
                <Button
                  size="sm"
                  aria-label={t('settings:teams.editLabel', { name: team.name })}
                  onClick={() => setEditing(team)}
                >
                  {t('settings:teams.edit')}
                </Button>
                {team.archivedAt === null ? (
                  <Button
                    size="sm"
                    aria-label={t('settings:teams.archiveLabel', { name: team.name })}
                    onClick={() => void archive(team)}
                  >
                    {t('settings:teams.archive')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    aria-label={t('settings:teams.restoreLabel', { name: team.name })}
                    onClick={() => void window.ostlerAPI.restoreTeam(team.id).then(changed)}
                  >
                    {t('settings:teams.restore')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('settings:teams.deleteLabel', { name: team.name })}
                  onClick={() => setDeleting(team)}
                >
                  {t('settings:teams.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ostler-teams__empty">{t('settings:teams.none')}</p>
      )}
      {archivedCount > 0 && (
        <Checkbox
          label={t('settings:teams.showArchived', { count: archivedCount })}
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
      )}
      {editing && (
        <TeamDialog
          team={editing === 'new' ? null : editing}
          people={people.active.filter((person) => person.projectId === null)}
          onClose={() => setEditing(null)}
          onSave={async (team, draft) => {
            const saved =
              team === null
                ? await changed(
                    await window.ostlerAPI.createTeam({
                      name: draft.name,
                      color: draft.color,
                      leadPersonId: draft.leadPersonId,
                      memberIds: draft.memberIds
                    })
                  )
                : await saveEdit(team, draft, changed)
            if (saved) setEditing(null)
          }}
        />
      )}
      {deleting && (
        <Dialog
          open
          onClose={() => setDeleting(null)}
          title={t('settings:teams.deleteTitle', { name: deleting.name })}
          description={t('settings:teams.deleteBody')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {t('settings:teams.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const team = deleting
                  setDeleting(null)
                  void window.ostlerAPI.deleteTeam(team.id).then(changed)
                }}
              >
                {t('settings:teams.deleteConfirm')}
              </Button>
            </>
          }
        />
      )}
    </SettingsGroup>
  )
}

interface TeamDraft {
  name: string
  color: string
  leadPersonId: string | null
  memberIds: string[]
}

async function saveEdit(team: Team, draft: TeamDraft, changed: Changed): Promise<Team | null> {
  const updated = await changed(
    await window.ostlerAPI.updateTeam(team.id, {
      name: draft.name,
      color: draft.color,
      leadPersonId: draft.leadPersonId
    })
  )
  if (!updated) return null
  const sameMembers =
    draft.memberIds.length === team.memberIds.length &&
    draft.memberIds.every((id) => team.memberIds.includes(id))
  if (sameMembers) return updated
  return changed(await window.ostlerAPI.setTeamMembers(team.id, draft.memberIds))
}

/** A team's name, colour, lead and members: adding and editing a team. */
function TeamDialog({
  team,
  people,
  onClose,
  onSave
}: {
  team: Team | null
  people: readonly Person[]
  onClose: () => void
  onSave: (team: Team | null, draft: TeamDraft) => Promise<void>
}) {
  const [name, setName] = useState(team?.name ?? '')
  const [color, setColor] = useState(team?.color ?? PROJECT_COLORS[0])
  const [leadPersonId, setLeadPersonId] = useState(team?.leadPersonId ?? NO_LEAD)
  const [memberIds, setMemberIds] = useState<string[]>(team?.memberIds ?? [])
  const [busy, setBusy] = useState(false)
  const ready = name.trim().length > 0
  const toggle = (id: string, on: boolean) =>
    setMemberIds((current) => (on ? [...current, id] : current.filter((entry) => entry !== id)))

  const save = async () => {
    if (!ready || busy) return
    setBusy(true)
    await onSave(team, {
      name: name.trim(),
      color,
      leadPersonId: leadPersonId === NO_LEAD ? null : leadPersonId,
      memberIds
    })
    setBusy(false)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      title={team ? t('settings:teams.editTitle') : t('settings:teams.newTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('settings:teams.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!ready || busy}>
            {team ? t('settings:teams.save') : t('settings:teams.create')}
          </Button>
        </>
      }
    >
      <form
        className="ostler-teams__form"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <TextField
          label={t('settings:teams.name')}
          placeholder={t('settings:teams.namePlaceholder')}
          maxLength={MAX_TEAM_NAME}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <ProjectColorPicker
          colors={[...PROJECT_COLORS]}
          value={color}
          onChange={setColor}
          name={`team-colour-${team?.id ?? 'new'}`}
        />
        <Select
          label={t('settings:teams.lead')}
          options={[
            { value: NO_LEAD, label: t('settings:teams.noLead') },
            ...people.map((person) => ({ value: person.id, label: person.name }))
          ]}
          value={leadPersonId}
          onChange={(event) => setLeadPersonId(event.target.value)}
        />
        <fieldset className="ostler-teams__members">
          <legend>{t('settings:teams.members')}</legend>
          {people.length === 0 && (
            <p className="ostler-teams__empty">{t('settings:teams.noPeople')}</p>
          )}
          {people.map((person) => (
            <Checkbox
              key={person.id}
              label={person.name}
              checked={memberIds.includes(person.id)}
              onChange={(event) => toggle(person.id, event.target.checked)}
            />
          ))}
        </fieldset>
      </form>
    </Dialog>
  )
}
