import { stepIndex } from '../../ui/roving'
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import { BRAND } from '@shared/brand'
import { cloudFileOf, type CloudFileService } from '@shared/cloud-file-link'
import { t } from '@shared/i18n'
import { itemLinkUrl, type LinkTargetKind } from '@shared/item-links'
import { cleanWhiteboardLink } from '@shared/whiteboard/model'
import {
  LINK_SEARCH_DELAY_MS,
  searchLinkTargets,
  type LinkTargetOption
} from '../../hooks/useItemLinkPicker'
import { Button, Dialog, ErrorText, TextField } from '../../ui'
import { ITEM_LINK_ICONS, itemKindLabel } from '../../ui/ItemLinkChip'
import { Icon } from '../../ui/icons'
import { cx } from '../../ui/cx'
import '../../ui/Markdown.css'

export interface LinkDialogProps {
  /**
   * `link` links the selected object; `card` places a new card. A card takes
   * item links only, so the Web address field is hidden for both `card` and
   * `itemsOnly`.
   */
  mode: 'link' | 'card'
  /** The object being linked is a card: only item links are offered. */
  itemsOnly?: boolean
  /** The project searched; null leaves only the Web address field. */
  projectId: string | null
  /** The spoken name of the object being linked (mode `link`). */
  objectName?: string
  /** The object has a link that Remove link would clear. */
  canRemove?: boolean
  /** The chosen link (an item link or a web address), or null to remove the link. */
  onChoose(url: string | null): void
  onClose(): void
}

/** One thing the dialog lists before anything is typed: a link target, newest first. */
export interface BrowseOption extends LinkTargetOption {
  /** A Library link to a file in OneDrive, SharePoint, Google Drive or Dropbox. */
  cloud?: CloudFileService
  updatedAt: number
}

/** What the dialog's filter shows: every kind, one kind, or the cloud files. */
type LinkFilter = 'all' | LinkTargetKind | 'cloud'
const FILTERS: readonly LinkFilter[] = ['all', 'task', 'milestone', 'decision', 'library', 'cloud']

/** At most this many things are listed at once. */
const LIST_LIMIT = 60

const time = (value: string | number) =>
  typeof value === 'number' ? value : Date.parse(value) || 0

/**
 * The project's tasks, milestones, decisions and Library items, newest
 * first: what the dialog lists before anything is typed. A Library link into
 * a cloud service is marked with its service.
 */
export async function browseLinkTargets(projectId: string): Promise<BrowseOption[]> {
  const api = window.ostlerAPI
  const [tasks, milestones, decisions, library] = await Promise.all([
    api.getPlanningWorkItems(projectId),
    api.getPlanningMilestones(projectId),
    api.getPlanningDecisions(projectId),
    api.listLibraryItems(projectId)
  ])
  const options: BrowseOption[] = []
  if (tasks.ok) {
    for (const task of tasks.value) {
      options.push({
        kind: 'task',
        id: task.id,
        projectId,
        title: task.title,
        updatedAt: task.updatedAt
      })
    }
  }
  if (milestones.ok) {
    for (const milestone of milestones.value) {
      options.push({
        kind: 'milestone',
        id: milestone.id,
        projectId,
        title: milestone.name,
        updatedAt: milestone.updatedAt
      })
    }
  }
  if (decisions.ok) {
    for (const decision of decisions.value) {
      options.push({
        kind: 'decision',
        id: decision.id,
        projectId,
        title: decision.title,
        updatedAt: decision.updatedAt
      })
    }
  }
  if (library.ok) {
    for (const item of library.value) {
      if (item.archivedAt) continue
      const cloud = cloudFileOf(item.url)?.service
      options.push({
        kind: 'library',
        id: item.id,
        projectId,
        title: item.title,
        updatedAt: time(item.updatedAt),
        ...(cloud ? { cloud } : {})
      })
    }
  }
  return options.sort((a, b) => b.updatedAt - a.updatedAt)
}

function passes(option: { kind: LinkTargetKind; cloud?: CloudFileService }, filter: LinkFilter) {
  if (filter === 'all') return true
  if (filter === 'cloud') return option.cloud !== undefined
  return option.kind === filter
}

/**
 * The whiteboard's Link dialog (plan `docs/plans/whiteboards/`, prompt 12,
 * D10): the project's tasks, milestones, decisions and Library items listed
 * as soon as it opens, newest first, with a filter by kind and one for cloud
 * files (Library links to OneDrive, SharePoint, Google Drive or Dropbox).
 * Typing searches them with the same search as the `[[` picker
 * (`searchLinkTargets`); a web address can be typed instead. Arrow keys move
 * through the list and Enter chooses one. Mount it only while open.
 */
export function LinkDialog({
  mode,
  itemsOnly = false,
  projectId,
  objectName,
  canRemove = false,
  onChoose,
  onClose
}: LinkDialogProps) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<LinkTargetOption[]>([])
  const [active, setActive] = useState(0)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [web, setWeb] = useState('')
  const [webError, setWebError] = useState<string | null>(null)
  const [filter, setFilter] = useState<LinkFilter>('all')
  const [browse, setBrowse] = useState<BrowseOption[] | null>(null)
  const webShown = mode === 'link' && !itemsOnly
  const trimmed = query.trim()

  // Everything that can be linked, listed as soon as the dialog opens.
  useEffect(() => {
    if (projectId === null) return
    let live = true
    browseLinkTargets(projectId).then(
      (found) => {
        if (live) setBrowse(found)
      },
      (error: unknown) => {
        if (live) setSearchError(error instanceof Error ? error.message : String(error))
      }
    )
    return () => {
      live = false
    }
  }, [projectId])

  /** Cloud services by Library item, for the search's hits. */
  const cloudById = useMemo(
    () =>
      new Map(
        (browse ?? []).flatMap((option): [string, CloudFileService][] =>
          option.cloud ? [[option.id, option.cloud]] : []
        )
      ),
    [browse]
  )

  useEffect(() => {
    if (trimmed === '' || projectId === null) {
      setOptions([])
      setSearched(false)
      return
    }
    let live = true
    const timer = window.setTimeout(() => {
      searchLinkTargets(projectId, trimmed).then(
        (found) => {
          if (!live) return
          setOptions(found)
          setActive(0)
          setSearched(true)
          setSearchError(null)
        },
        (error: unknown) => {
          if (live) setSearchError(error instanceof Error ? error.message : String(error))
        }
      )
    }, LINK_SEARCH_DELAY_MS)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [trimmed, projectId])

  /** What the list shows: the search's hits, or before anything is typed everything, newest first. */
  const shown: (LinkTargetOption & { cloud?: CloudFileService })[] = (
    trimmed === ''
      ? (browse ?? [])
      : options.map((option) => {
          const cloud = option.kind === 'library' ? cloudById.get(option.id) : undefined
          return cloud ? { ...option, cloud } : option
        })
  )
    .filter((option) => passes(option, filter))
    .slice(0, LIST_LIMIT)

  useEffect(() => setActive(0), [filter, trimmed])

  const chooseOption = (option: LinkTargetOption) =>
    onChoose(
      itemLinkUrl(
        { kind: option.kind, projectId: option.projectId, id: option.id },
        BRAND.urlScheme
      )
    )

  /** Link (or Add card): the typed web address when there is one, otherwise the highlighted result. */
  const submit = () => {
    if (webShown && web.trim() !== '') {
      try {
        onChoose(cleanWhiteboardLink(web))
      } catch {
        setWebError(t('library:whiteboard.link.webInvalid'))
      }
      return
    }
    const option = shown[Math.min(active, shown.length - 1)]
    if (option) chooseOption(option)
  }

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (shown.length === 0) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : (-1 as const)
      setActive((current) => stepIndex(current, step, shown.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = shown[Math.min(active, shown.length - 1)]
      if (option) chooseOption(option)
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`
  const canSubmit = (webShown && web.trim() !== '') || shown.length > 0
  const card = mode === 'card'

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(card ? 'library:whiteboard.link.cardTitle' : 'library:whiteboard.link.title')}
      description={
        card
          ? t('library:whiteboard.link.cardDescription')
          : t(
              itemsOnly
                ? 'library:whiteboard.link.cardLinkDescription'
                : 'library:whiteboard.link.description',
              { name: objectName ?? '' }
            )
      }
      footer={
        <>
          {canRemove && !card && !itemsOnly && (
            <Button variant="ghost" onClick={() => onChoose(null)}>
              {t('library:whiteboard.link.remove')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('library:whiteboard.link.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {t(card ? 'library:whiteboard.link.addCard' : 'library:whiteboard.link.link')}
          </Button>
        </>
      }
    >
      {projectId !== null && (
        <div className="wb-link-dialog__search">
          <TextField
            label={t('library:whiteboard.link.search')}
            hint={t('library:whiteboard.link.searchHint')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
            data-autofocus=""
          />
          <div
            className="wb-link-dialog__filters"
            role="group"
            aria-label={t('library:whiteboard.link.filter')}
          >
            {FILTERS.map((option) => (
              <Button
                key={option}
                variant="ghost"
                size="sm"
                aria-pressed={filter === option}
                className="wb-link-dialog__filter"
                onClick={() => setFilter(option)}
              >
                {t(`library:whiteboard.link.filters.${option}`)}
              </Button>
            ))}
          </div>
          <ul
            role="listbox"
            id={listId}
            aria-label={t('library:whiteboard.link.results')}
            className="wb-link-dialog__results"
          >
            {shown.map((option, index) => (
              <li
                key={`${option.kind}:${option.id}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={cx('ui-item-link-picker__option', index === active && 'is-active')}
                // Keep focus in the search field while choosing with the mouse.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseOption(option)}
              >
                <Icon icon={ITEM_LINK_ICONS[option.kind]} />
                <span className="ui-item-link-picker__title">{option.title}</span>
                <span className="ui-item-link-picker__kind">
                  {option.cloud
                    ? t(`library:cloudFile.service.${option.cloud}`)
                    : itemKindLabel(option.kind)}
                </span>
              </li>
            ))}
          </ul>
          {((searched && trimmed !== '') || (trimmed === '' && browse !== null)) &&
            shown.length === 0 &&
            !searchError && (
              <p className="wb-link-dialog__empty">
                {t(
                  filter === 'cloud'
                    ? 'library:whiteboard.link.noCloudFiles'
                    : trimmed === ''
                      ? 'library:whiteboard.link.nothingYet'
                      : 'library:whiteboard.link.noMatches'
                )}
              </p>
            )}
          {filter === 'cloud' && (
            <p className="wb-link-dialog__empty">{t('library:whiteboard.link.cloudHint')}</p>
          )}
          {searchError && (
            <ErrorText>
              {t('library:whiteboard.link.searchFailed', { error: searchError })}
            </ErrorText>
          )}
        </div>
      )}
      {webShown && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <TextField
            label={t('library:whiteboard.link.web')}
            hint={t('library:whiteboard.link.webHint')}
            error={webError ?? undefined}
            type="url"
            inputMode="url"
            value={web}
            onChange={(event) => {
              setWeb(event.target.value)
              setWebError(null)
            }}
            {...(projectId === null ? { 'data-autofocus': '' } : {})}
          />
        </form>
      )}
    </Dialog>
  )
}
