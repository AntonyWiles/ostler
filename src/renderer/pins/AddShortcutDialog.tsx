import { useEffect, useId, useState } from 'react'
import type { PinKind, RendererProject, SavedView, SearchResult } from '@shared/ostler-api'
import { useFeatures, viewContext } from '../navigation/features'
import { allProjectViews } from '../navigation/registry'
import { Button, Dialog, InlineAlert, SearchField, SegmentedControl, TextField } from '../ui'
import { Icon, Layers, type LucideIcon } from '../ui/icons'
import { SEARCH_TYPES } from '../views/search/search-results'
import { usePins } from './PinsProvider'
import { t } from '@shared/i18n'

interface Candidate {
  key: string
  kind: PinKind
  targetId: string
  title: string
  icon: LucideIcon
}

const SEARCH_DELAY_MS = 120

/** Only https addresses: a shortcut is a link someone opens all day. */
export function httpsAddress(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * Add a shortcut (N5.2a): pin one of the project's items or views to its
 * Overview, or make a new Library link (a name and an https address, kept in
 * the Library as every link is) and pin that.
 */
export function AddShortcutDialog({
  project,
  onClose
}: {
  project: RendererProject
  onClose: () => void
}) {
  const pins = usePins()
  const features = useFeatures()
  const [mode, setMode] = useState<'item' | 'link'>('item')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<SearchResult[]>([])
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const listId = useId()

  useEffect(() => {
    let cancelled = false
    void window.ostlerAPI.listSavedViews(project.id).then((result) => {
      if (!cancelled && result.ok) setSavedViews(result.value.filter((view) => !view.isDefault))
    })
    return () => {
      cancelled = true
    }
  }, [project.id])

  const trimmed = query.trim()
  useEffect(() => {
    if (!trimmed) {
      setFound([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.ostlerAPI
        .search(trimmed, {
          projectId: project.id,
          types: ['task', 'milestone', 'decision', 'library'],
          limit: 20
        })
        .then((result) => {
          if (!cancelled) setFound(result.ok ? result.value : [])
        })
    }, SEARCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, project.id])

  const needle = trimmed.toLowerCase()
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle)
  const candidates: Candidate[] = [
    ...found.flatMap((result): Candidate[] =>
      result.type === 'task' ||
      result.type === 'milestone' ||
      result.type === 'decision' ||
      result.type === 'library'
        ? [
            {
              key: `${result.type}:${result.id}`,
              kind: result.type,
              targetId: result.id,
              title: result.title,
              icon: SEARCH_TYPES[result.type].icon
            }
          ]
        : []
    ),
    ...savedViews
      .filter((view) => matches(view.name))
      .map((view) => ({
        key: `saved-view:${view.id}`,
        kind: 'saved-view' as const,
        targetId: view.id,
        title: view.name,
        icon: Layers
      })),
    ...allProjectViews(viewContext(features, project))
      .filter((view) => matches(view.label))
      .map((view) => ({
        key: `project-view:${view.id}`,
        kind: 'project-view' as const,
        targetId: view.id,
        title: view.label,
        icon: view.icon
      }))
  ]

  const pinCandidate = async (candidate: Candidate) => {
    setBusy(true)
    const made = await pins.pin('overview', { ...candidate, projectId: project.id })
    setBusy(false)
    if (made) onClose()
  }

  const addLink = async () => {
    const title = name.trim()
    const url = httpsAddress(address)
    if (!title) return setError(t('common:pins.enterName'))
    if (!url) return setError(t('common:pins.enterHttpsAddress'))
    setBusy(true)
    setError(null)
    const created = await window.ostlerAPI.createLibraryItem(project.id, {
      kind: 'link',
      title,
      url,
      body: ''
    })
    if (!created.ok) {
      setBusy(false)
      return setError(created.error)
    }
    const made = await pins.pin('overview', {
      kind: 'library',
      targetId: created.value.id,
      projectId: project.id,
      title
    })
    setBusy(false)
    if (made) onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('common:pins.addShortcut')}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common:pins.cancel')}
          </Button>
          {mode === 'link' && (
            <Button onClick={() => void addLink()} disabled={busy}>
              {t('common:pins.add')}
            </Button>
          )}
        </>
      }
    >
      <div className="add-shortcut">
        <SegmentedControl
          label={t('common:pins.addShortcut')}
          options={[
            { value: 'item', label: t('common:pins.addShortcutExisting') },
            { value: 'link', label: t('common:pins.addShortcutLink') }
          ]}
          value={mode}
          onChange={(value) => {
            setMode(value)
            setError(null)
          }}
        />
        {mode === 'item' ? (
          <>
            <SearchField
              label={t('common:pins.findItem')}
              placeholder={t('common:pins.findItemPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-controls={listId}
            />
            <ul
              id={listId}
              className="add-shortcut__results"
              aria-label={t('common:pins.findItem')}
            >
              {candidates.length === 0 && (
                <li className="add-shortcut__empty">{t('common:pins.nothingToPin')}</li>
              )}
              {candidates.slice(0, 30).map((candidate) => {
                const pinned = pins.find('overview', { ...candidate, projectId: project.id })
                return (
                  <li key={candidate.key}>
                    <button
                      type="button"
                      className="add-shortcut__result"
                      disabled={busy || pinned !== null}
                      onClick={() => void pinCandidate(candidate)}
                    >
                      <Icon icon={candidate.icon} />
                      <span className="add-shortcut__title">{candidate.title}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <>
            <TextField
              label={t('common:pins.linkName')}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label={t('common:pins.linkAddress')}
              hint={t('common:pins.linkAddressHint')}
              placeholder={t('library:libraryLinkModal.https')}
              inputMode="url"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </>
        )}
        {error && <InlineAlert tone="danger" title={error} />}
      </div>
    </Dialog>
  )
}
