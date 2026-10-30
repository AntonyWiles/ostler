import { useConfig } from '../hooks/useConfig'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import type {
  MembershipEvent,
  PersonLinkCandidate,
  RendererProject,
  ShareMember,
  ShareRole,
  ShareState,
  SyncPlaceView,
  SyncServerState
} from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { formatDate, formatDateTime } from '@shared/format'
import { t } from '@shared/i18n'
import {
  capabilitiesOf,
  ROLE_CAPABILITIES,
  SHARE_ROLES,
  type RoleCapabilities
} from '@shared/share-roles'
import { shareFolderName, sharePlaceKind } from '@shared/sync-place'
import {
  Badge,
  Button,
  Dialog,
  InlineAlert,
  Select,
  Skeleton,
  Switch,
  TextField,
  useConfirm,
  useToast,
  VisuallyHidden
} from '../ui'
import { Check, Icon, Minus } from '../ui/icons'
import { CareGroup, CareRow } from './project-care/CareRow'
import { placeOf } from '../devices/place'
import { openSettingsGroup } from '../views/settings/settings-form'
import { settingsPath } from '../navigation/paths'
import { usePeople } from '../context/PeopleContext'
import { PlaceChooser } from '../devices/PlaceChooser'
import { sharedWith } from './StatusBarSharing'

const STATUS_TONE = {
  'up-to-date': 'success',
  'catching-up': 'info',
  'cannot-reach-folder': 'warning',
  problems: 'danger'
} as const

/** The name of a role, as the interface says it. */
function roleLabel(role: ShareRole): string {
  if (role === 'owner') return t('projects:projectSharing.roleOwner')
  if (role === 'editor') return t('projects:projectSharing.roleEditor')
  if (role === 'contributor') return t('projects:projectSharing.roleContributor')
  return t('projects:projectSharing.roleViewer')
}

/** The capabilities in the order the "What each role can do" table lists them. */
const CAPABILITY_KEYS = Object.keys(ROLE_CAPABILITIES.owner) as (keyof RoleCapabilities)[]

/** Project settings › Sharing: what each role may do, drawn from the one definition of the rights. */
function RoleCapabilitiesTable() {
  return (
    <details className="project-sharing-roles">
      <summary>{t('projects:projectSharing.capabilitiesTitle')}</summary>
      <table className="project-sharing-roles__table">
        <thead>
          <tr>
            <td />
            {SHARE_ROLES.map((role) => (
              <th key={role} scope="col">
                {roleLabel(role)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAPABILITY_KEYS.map((key) => (
            <tr key={key}>
              <th scope="row">{t(`projects:projectSharing.capabilities.${key}`)}</th>
              {SHARE_ROLES.map((role) => (
                <td key={role}>
                  {ROLE_CAPABILITIES[role][key] ? (
                    <Icon icon={Check} label={t('projects:projectSharing.capabilityYes')} />
                  ) : (
                    <>
                      <Icon icon={Minus} />
                      <VisuallyHidden>{t('projects:projectSharing.capabilityNo')}</VisuallyHidden>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** One history line: who did what, then the date when it is known. */
function historyLine(event: MembershipEvent): string {
  let text: string
  if (event.kind === 'joined') {
    text = t(
      event.role === 'owner'
        ? 'projects:projectSharing.historyFounded'
        : 'projects:projectSharing.historyJoined',
      { name: event.name }
    )
  } else if (event.kind === 'left') {
    text = t('projects:projectSharing.historyLeft', { name: event.name })
  } else if (event.kind === 'removed') {
    text = t('projects:projectSharing.historyRemoved', { name: event.name })
  } else if (event.kind === 'invites-stopped') {
    text = event.byName
      ? t('projects:projectSharing.historyInvitesStopped', { by: event.byName })
      : t('projects:projectSharing.historyInvitesStoppedNoBy')
  } else {
    const role = roleLabel(event.role ?? 'viewer')
    text = event.byName
      ? t('projects:projectSharing.historyRoleChanged', {
          by: event.byName,
          name: event.name,
          role
        })
      : t('projects:projectSharing.historyRoleChangedNoBy', { name: event.name, role })
  }
  return event.at === null
    ? text
    : t('projects:projectSharing.historyLine', { text, date: formatDate(event.at) })
}

/** Project settings › Sharing: who joined, left, was removed and changed role. Every member sees it. */
function MembershipHistory({ events }: { events: MembershipEvent[] }) {
  return (
    <details className="project-sharing-roles">
      <summary>{t('projects:projectSharing.historyTitle')}</summary>
      {events.length === 0 ? (
        <p>{t('projects:projectSharing.historyEmpty')}</p>
      ) : (
        <ul className="project-sharing-history">
          {events.map((event, index) => (
            <li key={`${event.kind}-${event.personKey}-${index}`}>{historyLine(event)}</li>
          ))}
        </ul>
      )}
    </details>
  )
}

/**
 * Removing a person from a shared project. Their open tasks here can go to
 * someone else in the same step (Me by default) or to nobody; main hands them
 * on before the key changes.
 */
function RemoveMemberDialog({
  member,
  project,
  busy,
  onCancel,
  onRemove
}: {
  member: ShareMember
  project: RendererProject
  busy: boolean
  onCancel: () => void
  onRemove: (giveOpenTasksTo: string | null) => void
}) {
  const people = usePeople()
  const takers = people.offered(project.id).filter((candidate) => candidate.id !== member.personId)
  const [taker, setTaker] = useState<string | null>(null)
  const chosen = taker ?? takers.find((candidate) => candidate.isMe)?.id ?? ''
  const openTasks = member.openTasks ?? 0
  return (
    <Dialog
      open
      role="alertdialog"
      size="sm"
      onClose={onCancel}
      canDismiss={!busy}
      title={t('projects:projectSharing.removeTitle', {
        name: member.name,
        projectName: project.name
      })}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {t('common:confirm.cancel')}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => onRemove(chosen || null)}>
            {t('projects:projectSharing.removeConfirm')}
          </Button>
        </>
      }
    >
      <p>{t('projects:projectSharing.removeBody')}</p>
      {openTasks > 0 && (
        <p>
          {t('projects:projectSharing.removeOpenTasks', { name: member.name, count: openTasks })}
        </p>
      )}
      <Select
        label={t('projects:projectSharing.removeGiveTo')}
        value={chosen}
        onChange={(event) => setTaker(event.target.value)}
        options={[
          ...takers.map((candidate) => ({
            value: candidate.id,
            label: candidate.isMe
              ? t('settings:deletePersonDialog.you', { personName: candidate.name })
              : candidate.name
          })),
          { value: '', label: t('projects:projectSharing.removeNobody') }
        ]}
      />
    </Dialog>
  )
}

/** What the sharer does with the folder for someone to join, in the sync app it is in ("share the folder … in Google Drive."). */
function shareFolderStep(folder: string): string {
  const kind = sharePlaceKind(folder)
  return t(`projects:projectSharing.shareFolderStep.${kind === 'server' ? 'folder' : kind}`, {
    folder: shareFolderName(folder)
  })
}

/**
 * Project settings › Sharing (docs/plans/integrations/shared-folder-sync.md, S9c):
 * share the project through a folder people already sync, then see who is in
 * it and how it stands. Before it is shared there is one button; the member
 * list, invite and the rest appear only once it is. The invite never reaches
 * this window: main copies it to the clipboard.
 */
export function ProjectSharingPanel({ project }: { project: RendererProject }) {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [state, setState] = useState<ShareState | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The role the invite gives: an Editor unless the Owner picks a Viewer.
  const [inviteRole, setInviteRole] = useState<'editor' | 'contributor' | 'viewer'>('editor')
  // Email invite (MOP-4): the address, once asked for; null while closed.
  const [emailTo, setEmailTo] = useState<string | null>(null)
  const emailSettings = useConfig().config?.email
  const emailReady = Boolean(emailSettings?.host && emailSettings.fromAddress)
  // The sync server (integrations phase 7): a second way to share, once it is set up.
  const [server, setServer] = useState<SyncServerState | null>(null)
  // Google Drive: a third way to share, once a Google account that can sync through Drive is connected.
  const [driveReady, setDriveReady] = useState(false)
  // Give access (Drive shares): the teammate's Google email and the role they get.
  const [grantTo, setGrantTo] = useState('')
  const [grantRole, setGrantRole] = useState<'editor' | 'viewer'>('editor')
  // "Is this Bob?" (D12): people here who may be a member's person, not yet answered.
  const [links, setLinks] = useState<PersonLinkCandidate[]>([])
  // The sync apps' folders on this PC, offered as places to share through.
  const [places, setPlaces] = useState<SyncPlaceView[]>([])
  const [removing, setRemoving] = useState<ShareMember | null>(null)
  const [stoppingInvites, setStoppingInvites] = useState(false)
  const [history, setHistory] = useState<MembershipEvent[]>([])
  const [awayShared, setAwayShared] = useState(false)

  useEffect(() => {
    void window.ostlerAPI.getSyncServer().then((result) => {
      if (result.ok) setServer(result.value)
    })
    void window.ostlerAPI.getDriveSharingReady().then((result) => {
      if (result.ok) setDriveReady(result.value)
    })
    void window.ostlerAPI.listSyncPlaces().then((result) => {
      if (result.ok) setPlaces(result.value)
    })
  }, [])

  const load = useCallback(async () => {
    const result = await window.ostlerAPI.getShareState(project.id)
    if (result.ok) setState(result.value)
    else setError(result.error)
    const candidates = await window.ostlerAPI.getPersonLinks(project.id)
    if (candidates.ok) setLinks(candidates.value)
    const events = await window.ostlerAPI.getMembershipHistory(project.id)
    if (events.ok) setHistory(events.value)
    const away = await window.ostlerAPI.getAwaySharing?.(project.id)
    if (away?.ok) setAwayShared(away.value)
  }, [project.id])

  useEffect(() => {
    void load()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'sharing' && update.projectId === project.id) void load()
    })
  }, [load, project.id])

  /** Runs one action at a time, naming it so only its button spins. */
  const run = async <T,>(
    name: string,
    action: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>
  ): Promise<{ value: T } | undefined> => {
    setBusy(name)
    setError(null)
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return undefined
      }
      return { value: result.value }
    } finally {
      setBusy(null)
    }
  }

  const share = async (place: string | undefined) => {
    const done = await run('share', () => window.ostlerAPI.shareProject(project.id, place))
    if (!done?.value) return
    setState(done.value)
    toast({
      title: t('projects:projectSharing.sharedTitle', { projectName: project.name }),
      body: t('projects:projectSharing.sharedBody', {
        folderStep: shareFolderStep(done.value.folder)
      }),
      tone: 'success'
    })
  }

  const shareOnServer = async () => {
    const done = await run('server', () => window.ostlerAPI.shareProjectOnServer(project.id))
    if (!done) return
    setState(done.value)
    toast({
      title: t('projects:projectSharing.sharedTitle', { projectName: project.name }),
      body: t('projects:projectSharing.sharedOnServerBody'),
      tone: 'success'
    })
  }

  const shareOnDrive = async () => {
    const done = await run('drive', () => window.ostlerAPI.shareProjectOnDrive(project.id))
    if (!done) return
    setState(done.value)
    toast({
      title: t('projects:projectSharing.sharedTitle', { projectName: project.name }),
      body: t('projects:projectSharing.sharedOnDriveBody'),
      tone: 'success'
    })
  }

  const grantAccess = async (event: FormEvent) => {
    event.preventDefault()
    const address = grantTo.trim()
    if (!address) return
    const done = await run('grant', async () => {
      const granted = await window.ostlerAPI.grantDriveAccess(project.id, address, grantRole)
      if (!granted.ok) return granted
      // The invite goes on the clipboard as it does for any share; Google emails the access link.
      return window.ostlerAPI.copyShareInvite(project.id, grantRole)
    })
    if (!done) return
    setGrantTo('')
    toast({ title: t('projects:projectSharing.accessGiven', { address }), tone: 'success' })
  }

  const copyInvite = async () => {
    const done = await run('invite', () => window.ostlerAPI.copyShareInvite(project.id, inviteRole))
    if (done) toast({ title: t('projects:projectSharing.inviteCopied'), tone: 'success' })
  }

  const openEmailInvite = () => {
    setEmailTo('')
  }

  const emailInvite = async (event: FormEvent) => {
    event.preventDefault()
    const to = emailTo?.trim() ?? ''
    if (!to) return
    const done = await run('email', () =>
      window.ostlerAPI.emailShareInvite(project.id, inviteRole, to)
    )
    if (!done) return
    setEmailTo(null)
    toast({ title: t('projects:projectSharing.inviteEmailed', { address: to }), tone: 'success' })
  }

  const changeRole = async (member: ShareMember, role: ShareRole) => {
    const done = await run(`role-${member.personKey}`, () =>
      window.ostlerAPI.setShareRole(project.id, member.personKey, role)
    )
    if (done) setState(done.value)
  }

  const syncNow = async () => {
    const done = await run('sync', () => window.ostlerAPI.syncShareNow(project.id))
    if (done) setState(done.value)
  }

  const leave = async (alone: boolean, onlyOwner: boolean) => {
    const ok = await confirm({
      title: alone
        ? t('projects:projectSharing.stopTitle', { projectName: project.name })
        : t('projects:projectSharing.leaveConfirmTitle', { projectName: project.name }),
      body: alone ? (
        t('projects:projectSharing.stopBody')
      ) : (
        <>
          <p>{t('projects:projectSharing.leaveConfirmBody')}</p>
          {onlyOwner && <p>{t('projects:projectSharing.onlyOwnerWarning')}</p>}
        </>
      ),
      confirmLabel: alone
        ? t('projects:projectSharing.stopSharing')
        : t('projects:projectSharing.leaveConfirm'),
      tone: 'danger'
    })
    if (!ok) return
    const done = await run('leave', () => window.ostlerAPI.leaveShare(project.id))
    if (!done) return
    await load()
    if (!alone) {
      toast({
        title: t('projects:projectSharing.leftTitle', { projectName: project.name }),
        body: t('projects:projectSharing.leftBody'),
        tone: 'success'
      })
    }
  }

  const removeMember = async (member: ShareMember, giveOpenTasksTo: string | null) => {
    const done = await run(`remove-${member.personKey}`, () =>
      window.ostlerAPI.removeSharePerson(project.id, member.personKey, giveOpenTasksTo)
    )
    setRemoving(null)
    if (!done) return
    setState(done.value)
    toast({ title: t('projects:projectSharing.removed', { name: member.name }), tone: 'success' })
  }

  const stopOldInvites = async () => {
    const done = await run('stop-invites', () => window.ostlerAPI.stopOldInvites(project.id))
    setStoppingInvites(false)
    if (!done) return
    setState(done.value)
    toast({ title: t('projects:projectSharing.stopInvitesDone'), tone: 'success' })
    void load()
  }

  const shareAway = async (on: boolean) => {
    const done = await run('away-sharing', () => window.ostlerAPI.setAwaySharing(project.id, on))
    if (done) setAwayShared(done.value)
  }

  const answerLink = async (link: PersonLinkCandidate, answer: 'yes' | 'no') => {
    const done = await run(`link-${link.personKey}-${link.candidatePersonId}`, () =>
      window.ostlerAPI.answerPersonLink(project.id, link.personKey, link.candidatePersonId, answer)
    )
    if (!done) return
    setLinks(done.value)
    if (answer === 'yes') await load()
  }

  const alert = error && (
    <InlineAlert tone="danger" onDismiss={() => setError(null)}>
      {error}
    </InlineAlert>
  )

  if (state === undefined) {
    return (
      <CareGroup title={t('projects:projectSharing.title')}>
        <div className="project-care-row">
          <Skeleton lines={2} />
        </div>
      </CareGroup>
    )
  }

  if (state === null) {
    return (
      <>
        {alert}
        <CareGroup
          title={t('projects:projectSharing.title')}
          description={t('projects:projectSharing.notSharedDescription')}
        >
          <CareRow
            title={t('projects:projectSharing.shareThisProject')}
            description={t('projects:projectSharing.shareThisProjectDescription')}
            action={
              <PlaceChooser
                places={places}
                busy={busy === 'share'}
                startLabel={t('projects:projectSharing.shareButton')}
                legend={t('projects:projectSharing.whereToShare', { brand: BRAND.name })}
                anotherLabel={t('projects:projectSharing.anotherFolder')}
                anotherHint={t('projects:projectSharing.anotherFolderHint')}
                confirmLabel={t('projects:projectSharing.shareHere')}
                cancelLabel={t('projects:projectSharing.cancel')}
                onChoose={(place) => void share(place)}
              />
            }
          />
          {driveReady ? (
            <CareRow
              title={t('projects:projectSharing.shareOnDrive')}
              description={t('projects:projectSharing.shareOnDriveDescription')}
              action={
                <Button
                  loading={busy === 'drive'}
                  disabled={busy !== null}
                  onClick={() => void shareOnDrive()}
                >
                  {t('projects:projectSharing.shareOnDriveButton')}
                </Button>
              }
            />
          ) : (
            <CareRow
              title={t('projects:projectSharing.shareOnDrive')}
              description={t('projects:projectSharing.driveNotReady')}
              action={<AccountsSettingsLink />}
            />
          )}
          {server?.ready && server.url && (
            <CareRow
              title={t('projects:projectSharing.shareOnServer')}
              description={t('projects:projectSharing.shareOnServerDescription', {
                server: hostOf(server.url)
              })}
              action={
                <Button
                  loading={busy === 'server'}
                  disabled={busy !== null}
                  onClick={() => void shareOnServer()}
                >
                  {t('projects:projectSharing.shareOnServerButton')}
                </Button>
              }
            />
          )}
        </CareGroup>
      </>
    )
  }

  // Only an Owner sees the controls that change the project's people (D1); Editors and Viewers see the roles.
  const isOwner = state.myRole === 'owner'
  // Owners and Editors invite (D13); an Editor only once every PC understands Editor invites.
  const canInvite = capabilitiesOf(state.myRole).invite
  const editorInviteBlocked =
    state.myRole === 'editor' && !state.sharedCapabilities.includes('editor-invites')
  // A Contributor may be offered only once every PC understands the role (D4).
  // Stopping old invites changes the key for everyone, so every PC must understand it.
  const canStopInvites = state.sharedCapabilities.includes('invite-reset')
  const canOfferContributor = state.sharedCapabilities.includes('contributor-role')
  // The other people still in it. With none, leaving is only stopping sharing.
  const others = state.members.filter((member) => !member.isMe && member.leftAt === undefined)
  const alone = others.length === 0
  // The last Owner leaving would leave nobody who can invite or remove people.
  const onlyOwner = isOwner && !alone && !others.some((member) => member.role === 'owner')
  const placeKind = sharePlaceKind(state.folder)
  const onServer = placeKind === 'server'
  const onDrive = placeKind === 'drive'
  // How someone gets in: share the folder in its sync app, then send the invite (no folder for the server).
  const inviteDescription = state.inPersonalSpace ? (
    t('projects:projectSharing.inPersonalSpaceDescription', { place: placeOf(state.folder) })
  ) : onDrive ? (
    t('projects:projectSharing.inviteDriveDescription')
  ) : onServer ? (
    t('projects:projectSharing.inviteServerDescription', { server: hostOf(state.folder) })
  ) : (
    <ol className="project-sharing-steps">
      <li>
        {t('projects:projectSharing.inviteStepFolder', {
          folderStep: shareFolderStep(state.folder)
        })}
      </li>
      <li>{t('projects:projectSharing.inviteStepSend')}</li>
    </ol>
  )

  return (
    <>
      {alert}
      {stoppingInvites && (
        <Dialog
          open
          role="alertdialog"
          size="sm"
          onClose={() => setStoppingInvites(false)}
          canDismiss={busy === null}
          title={t('projects:projectSharing.stopInvitesTitle')}
          footer={
            <>
              <Button onClick={() => setStoppingInvites(false)} disabled={busy !== null}>
                {t('common:confirm.cancel')}
              </Button>
              <Button
                variant="danger"
                loading={busy === 'stop-invites'}
                disabled={busy !== null}
                onClick={() => void stopOldInvites()}
              >
                {t('projects:projectSharing.stopInvitesConfirm')}
              </Button>
            </>
          }
        >
          <p>{t('projects:projectSharing.stopInvitesBody')}</p>
        </Dialog>
      )}
      {removing && (
        <RemoveMemberDialog
          member={removing}
          project={project}
          busy={busy !== null}
          onCancel={() => setRemoving(null)}
          onRemove={(giveOpenTasksTo) => void removeMember(removing, giveOpenTasksTo)}
        />
      )}
      <CareGroup
        title={t('projects:projectSharing.title')}
        description={
          <>
            <span>
              {sharedWith(state)}
              {' · '}
              {t('projects:projectSharing.youAre', { role: roleLabel(state.myRole) })}
            </span>{' '}
            <Badge tone={STATUS_TONE[state.status]}>
              {t(`projects:projectSharing.status.${state.status}`)}
            </Badge>{' '}
            {state.lastSyncedAt
              ? t('projects:projectSharing.lastSynced', {
                  when: formatDateTime(new Date(state.lastSyncedAt))
                })
              : t('projects:projectSharing.neverSynced')}
          </>
        }
        actions={
          <Button loading={busy === 'sync'} disabled={busy !== null} onClick={() => void syncNow()}>
            {t('projects:projectSharing.syncNow')}
          </Button>
        }
      >
        {onDrive ? (
          <CareRow
            title={t('projects:projectSharing.driveFolder')}
            description={t('projects:projectSharing.driveFolderDescription')}
            action={null}
          />
        ) : onServer ? (
          <CareRow
            title={t('projects:projectSharing.server')}
            description={hostOf(state.folder)}
            action={null}
          />
        ) : (
          <CareRow
            title={t('projects:projectSharing.folder')}
            description={<span title={state.folder}>{state.folder}</span>}
            action={null}
          />
        )}
        {canInvite && (
          <CareRow
            title={
              state.inPersonalSpace
                ? t('projects:projectSharing.invitePeople')
                : t('projects:projectSharing.invite')
            }
            description={inviteDescription}
            action={
              <>
                {!onServer && !onDrive && (
                  <Button
                    variant="ghost"
                    loading={busy === 'open-folder'}
                    disabled={busy !== null}
                    onClick={() =>
                      void run('open-folder', () => window.ostlerAPI.openShareFolder(project.id))
                    }
                  >
                    {t('projects:projectSharing.openFolder')}
                  </Button>
                )}
                <Select
                  label={t('projects:projectSharing.inviteAs')}
                  hideLabel
                  size="sm"
                  disabled={editorInviteBlocked}
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as 'editor' | 'contributor' | 'viewer')
                  }
                  options={[
                    { value: 'editor', label: t('projects:projectSharing.inviteCanEdit') },
                    {
                      value: 'contributor',
                      label: canOfferContributor
                        ? t('projects:projectSharing.inviteAsContributor')
                        : `${t('projects:projectSharing.inviteAsContributor')} - ${t('projects:projectSharing.contributorNeedsLatest', { brand: BRAND.name })}`,
                      disabled: !canOfferContributor
                    },
                    { value: 'viewer', label: t('projects:projectSharing.inviteCanView') }
                  ]}
                />
                <span className="project-care-backup__size">
                  {editorInviteBlocked
                    ? t('projects:projectSharing.editorsNeedLatest', { brand: BRAND.name })
                    : t(`projects:projectSharing.inviteRoleHint.${inviteRole}`)}
                </span>
                <Button
                  loading={busy === 'invite'}
                  disabled={busy !== null || editorInviteBlocked}
                  onClick={() => void copyInvite()}
                >
                  {t('projects:projectSharing.copyInvite')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy !== null || editorInviteBlocked}
                  aria-expanded={emailTo !== null}
                  onClick={() => (emailTo === null ? openEmailInvite() : setEmailTo(null))}
                >
                  {t('projects:projectSharing.emailInvite')}
                </Button>
              </>
            }
          />
        )}
        {isOwner && onDrive && (
          <form
            className="project-care-row project-sharing-email"
            onSubmit={(event) => void grantAccess(event)}
          >
            <TextField
              label={t('projects:projectSharing.giveAccessEmail')}
              type="email"
              required
              spellCheck={false}
              maxLength={255}
              value={grantTo}
              onChange={(event) => setGrantTo(event.target.value)}
            />
            <Select
              label={t('projects:projectSharing.inviteAs')}
              hideLabel
              size="sm"
              value={grantRole}
              onChange={(event) => setGrantRole(event.target.value as 'editor' | 'viewer')}
              options={[
                { value: 'editor', label: t('projects:projectSharing.inviteCanEdit') },
                { value: 'viewer', label: t('projects:projectSharing.inviteCanView') }
              ]}
            />
            <Button type="submit" loading={busy === 'grant'} disabled={busy !== null}>
              {t('projects:projectSharing.giveAccess')}
            </Button>
          </form>
        )}
        <div className="project-care-row">
          <Switch
            label={t('projects:projectSharing.awaySwitch')}
            hint={t('projects:projectSharing.awayHint')}
            checked={awayShared}
            disabled={busy !== null}
            onChange={(event) => void shareAway(event.target.checked)}
          />
        </div>
        {isOwner && (
          <CareRow
            title={t('projects:projectSharing.stopInvites')}
            description={
              state.invitesResetAt
                ? t('projects:projectSharing.stopInvitesLast', {
                    date: formatDate(state.invitesResetAt)
                  })
                : t('projects:projectSharing.stopInvitesDescription')
            }
            action={
              <>
                {!canStopInvites && (
                  <span className="project-care-backup__size">
                    {t('projects:projectSharing.stopInvitesNeedLatest', { brand: BRAND.name })}
                  </span>
                )}
                <Button
                  variant="danger"
                  disabled={busy !== null || !canStopInvites}
                  onClick={() => setStoppingInvites(true)}
                >
                  {t('projects:projectSharing.stopInvitesButton')}
                </Button>
              </>
            }
          />
        )}
        {canInvite &&
          emailTo !== null &&
          (emailReady ? (
            <form
              className="project-care-row project-sharing-email"
              onSubmit={(event) => void emailInvite(event)}
            >
              <TextField
                label={t('projects:projectSharing.emailTo')}
                type="email"
                autoFocus
                required
                spellCheck={false}
                maxLength={255}
                value={emailTo}
                onChange={(event) => setEmailTo(event.target.value)}
              />
              <Button type="submit" loading={busy === 'email'} disabled={busy !== null}>
                {t('projects:projectSharing.emailInvite')}
              </Button>
            </form>
          ) : (
            <div className="project-care-row">
              <p className="project-care-muted">{t('projects:projectSharing.emailSetUpFirst')}</p>
            </div>
          ))}
        {(state.waitingToSend > 0 || state.waitingToApply > 0) && (
          <div className="project-care-row">
            <p className="project-care-muted">
              {[
                state.waitingToSend > 0 &&
                  t('projects:projectSharing.waitingToSend', { count: state.waitingToSend }),
                state.waitingToApply > 0 &&
                  t('projects:projectSharing.waitingToApply', { count: state.waitingToApply })
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          </div>
        )}
        {state.removed && (
          <div className="project-care-row">
            <InlineAlert tone="warning" title={t('projects:projectSharing.removedHereTitle')}>
              {t('projects:projectSharing.removedHereBody')}
            </InlineAlert>
          </div>
        )}
        {state.problems.length > 0 && (
          <div className="project-care-row">
            <InlineAlert tone="warning" title={t('projects:projectSharing.problemsTitle')}>
              <ul aria-label={t('projects:projectSharing.problemsTitle')}>
                {state.problems.map((problem, index) => (
                  <li key={`${problem.kind}-${problem.reason}-${index}`}>
                    {problem.reason === 'not-allowed'
                      ? t('projects:projectSharing.problem.notAllowed')
                      : t(`projects:projectSharing.problem.${problem.kind}`, {
                          reason: problem.reason
                        })}
                  </li>
                ))}
              </ul>
            </InlineAlert>
          </div>
        )}
      </CareGroup>

      {links.length > 0 && (
        <CareGroup title={t('projects:projectSharing.personLinksTitle')}>
          {links.map((link) => (
            <CareRow
              key={`${link.personKey}-${link.candidatePersonId}`}
              title={t('projects:projectSharing.personLinkQuestion', {
                memberName: link.memberName,
                candidateName: link.candidateName
              })}
              action={
                <>
                  <Button
                    variant="primary"
                    loading={busy === `link-${link.personKey}-${link.candidatePersonId}`}
                    disabled={busy !== null}
                    onClick={() => void answerLink(link, 'yes')}
                  >
                    {t('projects:projectSharing.personLinkYes')}
                  </Button>
                  <Button disabled={busy !== null} onClick={() => void answerLink(link, 'no')}>
                    {t('projects:projectSharing.personLinkNo')}
                  </Button>
                </>
              }
            />
          ))}
        </CareGroup>
      )}

      <CareGroup title={t('projects:projectSharing.members', { count: state.members.length })}>
        <ul className="project-care-backups" aria-label={t('projects:projectSharing.membersList')}>
          {state.members.map((member) => (
            <li key={member.personKey} className="project-care-backup">
              <div className="project-care-backup__when">
                <span>{member.name}</span>
                {member.isMe && <Badge>{t('projects:projectSharing.thisPc')}</Badge>}
                {member.leftAt !== undefined ? (
                  <Badge>
                    {t('projects:projectSharing.leftOn', {
                      when: formatDateTime(new Date(member.leftAt))
                    })}
                  </Badge>
                ) : (
                  member.role &&
                  (!isOwner || member.isMe) && <Badge>{roleLabel(member.role)}</Badge>
                )}
                {member.devices.length > 1 && (
                  <Badge>
                    {t('projects:projectSharing.devices', { count: member.devices.length })}
                  </Badge>
                )}
                <span className="project-care-backup__size">
                  {t('projects:projectSharing.joined', {
                    when: formatDateTime(new Date(member.joinedAt))
                  })}
                </span>
              </div>
              {isOwner && !member.isMe && member.role && member.leftAt === undefined && (
                <Select
                  label={t('projects:projectSharing.changeRole', { name: member.name })}
                  hideLabel
                  size="sm"
                  value={member.role}
                  disabled={busy !== null}
                  onChange={(event) => void changeRole(member, event.target.value as ShareRole)}
                  options={SHARE_ROLES.map((role) => {
                    const blocked = role === 'contributor' && !canOfferContributor
                    return {
                      value: role,
                      label: blocked
                        ? `${roleLabel(role)} - ${t('projects:projectSharing.contributorNeedsLatest', { brand: BRAND.name })}`
                        : roleLabel(role),
                      disabled: blocked && member.role !== 'contributor'
                    }
                  })}
                />
              )}
              {isOwner && !member.isMe && !state.removed && member.leftAt === undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('projects:projectSharing.removeLabel', { name: member.name })}
                  loading={busy === `remove-${member.personKey}`}
                  disabled={busy !== null}
                  onClick={() => setRemoving(member)}
                >
                  {t('projects:projectSharing.remove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <MembershipHistory events={history} />
        <RoleCapabilitiesTable />
      </CareGroup>

      <CareGroup
        title={
          alone ? t('projects:projectSharing.stopSharing') : t('projects:projectSharing.leaveTitle')
        }
      >
        <CareRow
          title={
            alone
              ? t('projects:projectSharing.stopSharingOnThisPc')
              : t('projects:projectSharing.leaveRow', { projectName: project.name })
          }
          description={
            <ul className="project-sharing-leave">
              {!alone && <li>{t('projects:projectSharing.leaveOnlyYou')}</li>}
              <li>{t('projects:projectSharing.leaveKeepCopy')}</li>
              {!alone && <li>{t('projects:projectSharing.leaveOthersSee')}</li>}
              {state.inPersonalSpace && <li>{t('projects:projectSharing.leaveOtherPcs')}</li>}
              {!onServer && !onDrive && (
                <li>{t('projects:projectSharing.leaveFolder', { brand: BRAND.name })}</li>
              )}
              <li>{t('projects:projectSharing.leaveDeleteToo')}</li>
            </ul>
          }
          action={
            <Button
              variant="danger"
              loading={busy === 'leave'}
              disabled={busy !== null}
              onClick={() => void leave(alone, onlyOwner)}
            >
              {alone
                ? t('projects:projectSharing.stopSharing')
                : t('projects:projectSharing.leaveButton')}
            </Button>
          }
        />
        {onlyOwner && (
          <div className="project-care-row">
            <InlineAlert tone="warning">
              {t('projects:projectSharing.onlyOwnerWarning')}
            </InlineAlert>
          </div>
        )}
      </CareGroup>
    </>
  )
}

/** A button to Settings › Connections › Accounts, where a Google account is connected. */
function AccountsSettingsLink() {
  // Outside a router (a lone panel in a test) there is nowhere to go.
  return useInRouterContext() ? <AccountsLinkButton /> : null
}

function AccountsLinkButton() {
  const navigate = useNavigate()
  return (
    <Button
      onClick={() => {
        openSettingsGroup('accounts')
        navigate(settingsPath('connections'))
      }}
    >
      {t('projects:projectSharing.openAccounts')}
    </Button>
  )
}

/** `sync.example.com` for a server or one of its spaces. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
