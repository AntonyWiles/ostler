import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ImportLibraryResult,
  LibraryAiAccess,
  LibraryAiContextSummary,
  LibraryItem,
  UpdateLibraryItemInput
} from '@shared/ostler-api'
import { useNavigate } from 'react-router-dom'
import { newWhiteboardPath, projectPath, taskPath, whiteboardPath } from '../../../navigation/paths'
import { useDismissable } from '../../../hooks/useDismissable'
import { isTypingTarget } from '../../../utils/dom'
import { resolveShortcut, shortcut } from '../../../navigation/shortcuts'
import { LibraryAiFilter, LibraryTagFilter } from './LibraryFilters'
import { useLibraryDetailWidth } from './LibraryDetailResize'
import { LibraryItemList, Tick } from './LibraryItemList'
import { LibraryDetail } from './LibraryDetail'
import { LibraryEditor, type WrittenKind, type WrittenTemplate } from './LibraryEditor'
import { LibraryLinkModal } from './LibraryLinkModal'
import { LibraryPlanWorkModal } from './LibraryPlanWorkModal'
import { useLibrarySelection } from './useLibrarySelection'
import { bareHttpUrl, filesToImportInput, isWrittenKind, type LibrarySection } from './libraryUi'
import { useFeatures } from '../../../navigation/features'
import { Button, EmptyState, InlineAlert, Menu, SearchField, Tabs } from '../../../ui'
import {
  ChevronDown,
  Icon,
  Library,
  Plus,
  Sparkles,
  Upload,
  ClipboardPaste
} from '../../../ui/icons'
import { useTabsThatFit } from '../../../hooks/useTabsThatFit'
import { LIBRARY_SECTIONS } from './libraryUi'
import './LibraryPanel.css'
import { t } from '@shared/i18n'

const SEARCH_DEBOUNCE_MS = 250

interface LibraryPanelProps {
  projectId: string
  /** From `?item=<id>`: open with this item selected. */
  initialItemId: string | null
  /** From `?new=brief|guide|note`: open the editor on a new item (with its template). */
  initialNewKind?: WrittenKind | null
}

/** `seq` remounts the editor when a new item replaces another new item of the same kind. */
type EditorState = {
  kind: WrittenKind
  item: LibraryItem | null
  seq?: number
  template?: WrittenTemplate
} | null
type LinkModalState = { item: LibraryItem | null; initialUrl?: string } | null

/**
 * The Library tab: where a person captures and curates a project's briefs,
 * guides, references, documents, links and notes. Everything goes through the
 * library IPC calls; Ostler's own AI reads what is stored here, coding agents
 * do not.
 */
export function LibraryPanel({ projectId, initialItemId, initialNewKind }: LibraryPanelProps) {
  const features = useFeatures()
  const navigate = useNavigate()
  const [allItems, setAllItems] = useState<LibraryItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [context, setContext] = useState<LibraryAiContextSummary | null>(null)
  const [search, setSearch] = useState('')
  const [searchIds, setSearchIds] = useState<string[] | null>(null)
  const [section, setSection] = useState<LibrarySection>('all')
  const [access, setAccess] = useState<LibraryAiAccess | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [archived, setArchived] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(initialItemId)
  const [focusedId, setFocusedId] = useState<string | null>(initialItemId)
  const [editor, setEditor] = useState<EditorState>(
    initialNewKind ? { kind: initialNewKind, item: null } : null
  )
  const [planOpen, setPlanOpen] = useState(false)
  const [linkModal, setLinkModal] = useState<LinkModalState>(null)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [focusSummaryFor, setFocusSummaryFor] = useState<string | null>(null)

  const selection = useLibrarySelection()
  const rootRef = useRef<HTMLDivElement>(null)
  const detailWidth = useLibraryDetailWidth(rootRef)
  const sectionBar = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const summaryRef = useRef<HTMLTextAreaElement>(null)
  // Set when the editor closes: the item it had open ('' for none), which
  // takes focus once the list is back, so focus does not fall to the page.
  const refocusAfterEditor = useRef<string | null>(null)

  // ─── Data ─────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    const [items, summary] = await Promise.all([
      window.ostlerAPI.listLibraryItems(projectId, { includeArchived: true }),
      window.ostlerAPI.getLibraryAiContextSummary(projectId)
    ])
    if (items.ok) setAllItems(items.value)
    else setNotice({ text: items.error, error: true })
    if (summary.ok) setContext(summary.value)
    setLoaded(true)
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(
    () =>
      window.ostlerAPI.onProjectStateChange((update) => {
        if (update.projectId === projectId && update.field === 'library') void reload()
      }),
    [projectId, reload]
  )

  // Search runs server-side (FTS), debounced; the result order is its ranking.
  const [searchVersion, setSearchVersion] = useState(0)
  useEffect(() => {
    const query = search.trim()
    if (!query) {
      setSearchIds(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void window.ostlerAPI
        .listLibraryItems(projectId, { search: query, includeArchived: true })
        .then((result) => {
          if (cancelled) return
          if (result.ok) setSearchIds(result.value.map((item) => item.id))
          else setNotice({ text: result.error, error: true })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [projectId, search, searchVersion])

  // A live update can change what the search matches.
  useEffect(() => {
    if (search.trim()) setSearchVersion((version) => version + 1)
    selection.retain(allItems.map((item) => item.id))
  }, [allItems])

  // ?new=<kind> arriving while the tab is already open (the command palette).
  // An open editor gets a say first: it runs its unsaved-changes guard.
  const [pendingNewKind, setPendingNewKind] = useState<WrittenKind | null>(null)
  const editorOpen = editor !== null
  useEffect(() => {
    if (!initialNewKind) return
    if (editorOpen) setPendingNewKind(initialNewKind)
    else setEditor({ kind: initialNewKind, item: null })
  }, [initialNewKind])

  // ?item=<id> arriving while the tab is already open.
  useEffect(() => {
    if (!initialItemId) return
    setActiveId(initialItemId)
    setFocusedId(initialItemId)
  }, [initialItemId])

  const byId = useMemo(() => new Map(allItems.map((item) => [item.id, item])), [allItems])

  // A whiteboard is edited only in the Plan (D4): ?item=<whiteboard> (a link, a search
  // result, a pin) goes on there, in place of this address.
  const askedItem = initialItemId ? byId.get(initialItemId) : undefined
  useEffect(() => {
    if (askedItem?.kind === 'whiteboard')
      navigate(whiteboardPath(projectId, askedItem.id), { replace: true })
  }, [askedItem?.id, askedItem?.kind])
  const activeItem = activeId ? (byId.get(activeId) ?? null) : null

  // Deep-linking to an archived item shows the archive it lives in.
  useEffect(() => {
    if (activeItem?.archivedAt && activeId === initialItemId) setArchived(true)
  }, [activeItem?.id])

  const visible = useMemo(() => {
    const source = searchIds
      ? searchIds.map((id) => byId.get(id)).filter((item): item is LibraryItem => Boolean(item))
      : allItems
    return source.filter(
      (item) =>
        (archived ? Boolean(item.archivedAt) : !item.archivedAt) &&
        (archived || section === 'all' || item.kind === section) &&
        (!access || !features.ai || item.aiAccess === access) &&
        (!tag || item.tags.includes(tag))
    )
  }, [allItems, byId, searchIds, archived, section, access, features.ai, tag])

  const primary = visible.find((item) => item.isPrimaryBrief) ?? null
  const references = visible.filter((item) => item.kind === 'image')
  const rows = visible.filter((item) => item.kind !== 'image' && item !== primary)
  // Display order: banner, reference grid, rows. Arrow keys and Shift-click follow it.
  const orderedIds = [...(primary ? [primary] : []), ...references, ...rows].map((item) => item.id)

  // After an import, focus the new item's summary once its detail pane exists.
  useEffect(() => {
    if (focusSummaryFor && activeItem?.id === focusSummaryFor) {
      summaryRef.current?.focus()
      setFocusSummaryFor(null)
    }
  }, [focusSummaryFor, activeItem?.id])

  // ─── Actions ──────────────────────────────────────────────────────────────

  const report = (result: { ok: boolean; error?: string }): boolean => {
    if (!result.ok)
      setNotice({ text: result.error ?? t('library:libraryPanel.somethingWentWrong'), error: true })
    return result.ok
  }

  const select = (id: string) => {
    setActiveId(id)
    setFocusedId(id)
  }

  const open = (item: LibraryItem) => {
    if (item.kind === 'whiteboard') navigate(whiteboardPath(projectId, item.id))
    else if (isWrittenKind(item.kind)) setEditor({ kind: item.kind, item })
    else if (item.kind === 'link') setLinkModal({ item })
    else void window.ostlerAPI.openLibraryItemExternally(projectId, item.id).then(report)
  }

  const handleImported = (results: ImportLibraryResult[]) => {
    if (results.length === 0) return
    const fresh = results.filter((result) => !result.duplicateOf)
    const duplicates = results.filter((result) => result.duplicateOf)
    if (duplicates.length > 0) {
      const names = duplicates.map((result) => `“${result.item.title}”`).join(', ')
      setNotice({
        text:
          duplicates.length === 1
            ? t('library:libraryPanel.alreadyLibrary', { names })
            : t('library:libraryPanel.filesWereAlreadyLibrary', {
                duplicateCount: duplicates.length,
                names
              })
      })
    } else {
      setNotice(null)
    }
    const first = fresh[0] ?? duplicates[0]
    setArchived(Boolean(first.item.archivedAt))
    select(first.item.id)
    if (fresh.length > 0) setFocusSummaryFor(first.item.id)
    void reload()
  }

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return
    setNotice({ text: t('library:libraryPanel.importingFiles', { count: files.length }) })
    try {
      const input = await filesToImportInput(files)
      const result = await window.ostlerAPI.importLibraryFiles(projectId, input)
      if (report(result) && result.ok) handleImported(result.value)
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), error: true })
    }
  }

  const pickFiles = async () => {
    const result = await window.ostlerAPI.pickLibraryFiles(projectId)
    if (report(result) && result.ok) handleImported(result.value)
  }

  /** Import from clipboard: a picture, a copied file, a web address or text. */
  const importClipboard = async () => {
    const result = await window.ostlerAPI.importLibraryFromClipboard(projectId)
    if (!report(result) || !result.ok) return
    if (result.value === null) setNotice({ text: t('library:libraryPanel.clipboardEmpty') })
    else handleImported([result.value])
  }

  const updateActive = async (updates: UpdateLibraryItemInput) => {
    if (!activeItem) return
    if (report(await window.ostlerAPI.updateLibraryItem(projectId, activeItem.id, updates))) {
      await reload()
    }
  }

  const setPrimary = async (makePrimary: boolean) => {
    if (!activeItem) return
    const result = await window.ostlerAPI.setPrimaryBrief(
      projectId,
      makePrimary ? activeItem.id : null
    )
    if (report(result)) await reload()
  }

  const archiveActive = async () => {
    if (!activeItem) return
    const result = activeItem.archivedAt
      ? await window.ostlerAPI.unarchiveLibraryItem(projectId, activeItem.id)
      : await window.ostlerAPI.archiveLibraryItem(projectId, activeItem.id)
    if (report(result)) await reload()
  }

  const deleteActive = async () => {
    if (!activeItem) return
    if (report(await window.ostlerAPI.deleteLibraryItem(projectId, activeItem.id))) {
      setActiveId(null)
      await reload()
    }
  }

  const activate = (item: LibraryItem, event: React.MouseEvent) => {
    if (event.shiftKey) {
      selection.extendTo(item.id, orderedIds)
    } else if (event.ctrlKey || event.metaKey) {
      selection.toggle(item.id)
    }
    select(item.id)
  }

  // ─── Keyboard, paste, drop ────────────────────────────────────────────────

  const overlayOpen = editor !== null || linkModal !== null || planOpen

  useDismissable(selection.clear, {
    enabled: selection.ids.length > 0 && !overlayOpen
  })

  // Read through a ref so the window listeners register once.
  const keyState = useRef({ orderedIds, focusedId, byId, overlayOpen, open, selection })
  keyState.current = { orderedIds, focusedId, byId, overlayOpen, open, selection }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = keyState.current
      if (state.overlayOpen || event.defaultPrevented || isTypingTarget(event.target)) return
      // Only while focus is in this tab or nowhere in particular.
      const target = event.target as Node | null
      if (target && target !== document.body && !rootRef.current?.contains(target)) return

      const pressed = resolveShortcut(event, null)
      if (pressed && 'id' in pressed && pressed.id === 'library-search') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // The arrows, Space and Enter belong to a focused control (a button, a
      // tab); the list takes them in itself, or when nothing has focus (P9.2).
      if (target && target !== document.body && !(target as Element).matches?.('[role="listbox"]'))
        return

      const ids = state.orderedIds
      if (ids.length === 0) return
      const index = state.focusedId ? ids.indexOf(state.focusedId) : -1
      const move = (next: number) => {
        event.preventDefault()
        const id = ids[Math.max(0, Math.min(ids.length - 1, next))]
        setFocusedId(id)
        setActiveId(id)
        rootRef.current
          ?.querySelector(`[data-library-item="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      }
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          move(index + 1)
          break
        case 'ArrowUp':
        case 'ArrowLeft':
          move(index < 0 ? 0 : index - 1)
          break
        case ' ':
          if (state.focusedId) {
            event.preventDefault()
            state.selection.toggle(state.focusedId)
          }
          break
        case 'Enter': {
          const item = state.focusedId ? state.byId.get(state.focusedId) : undefined
          if (item) {
            event.preventDefault()
            state.open(item)
          }
          break
        }
      }
    }

    const onPaste = (event: ClipboardEvent) => {
      if (keyState.current.overlayOpen || isTypingTarget(event.target)) return
      const data = event.clipboardData
      if (!data) return
      const images = [...data.files].filter((file) => file.type.startsWith('image/'))
      if (images.length > 0) {
        event.preventDefault()
        void importFiles(images)
        return
      }
      const url = bareHttpUrl(data.getData('text/plain'))
      if (url) {
        event.preventDefault()
        setLinkModal({ item: null, initialUrl: url })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('paste', onPaste)
    }
  }, [projectId])

  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files')

  // ─── Render ───────────────────────────────────────────────────────────────

  const selectedNames = selection.ids
    .map((id) => byId.get(id)?.title)
    .filter((title): title is string => Boolean(title))

  const startNew = (kind: WrittenKind, template?: WrittenTemplate) =>
    setEditor({ kind, item: null, template })

  const closeEditor = () => {
    const id = editor?.item?.id ?? ''
    if (id) setFocusedId(id)
    refocusAfterEditor.current = id
    setPendingNewKind(null)
    setEditor(null)
  }

  // The editor stands in for the list, so closing it removes what had focus:
  // the item it edited takes focus (the banner, or the list pointing at it),
  // else the search field.
  useEffect(() => {
    const id = refocusAfterEditor.current
    if (editor || id === null) return
    refocusAfterEditor.current = null
    const item = id
      ? rootRef.current?.querySelector<HTMLElement>(`[data-library-item="${CSS.escape(id)}"]`)
      : null
    const target = item?.matches('button')
      ? item
      : (item?.closest<HTMLElement>('[role="listbox"]') ?? searchRef.current)
    target?.focus()
  }, [editor])

  const live = allItems.filter((item) => !item.archivedAt)
  const sectionTabs = [
    ...LIBRARY_SECTIONS.map((entry) => ({
      value: entry.id as LibrarySection | 'archived',
      label: entry.label,
      badge: entry.id === 'all' ? live.length : live.filter((item) => item.kind === entry.id).length
    })),
    {
      value: 'archived' as const,
      label: t('library:libraryPanel.archived'),
      badge: allItems.length - live.length
    }
  ]
  const sectionValue = archived ? 'archived' : section
  const onSectionChange = (value: LibrarySection | 'archived') => {
    if (value === 'archived') {
      setArchived(true)
      return
    }
    setArchived(false)
    setSection(value)
  }
  // Sections that don't fit the centre pane go in More, rather than off the
  // end of a row that scrolls.
  const fits = useTabsThatFit(
    sectionBar,
    sectionTabs.map((tab) => tab.value),
    sectionValue
  )
  const overflowSections = sectionTabs.filter((tab) => !fits.includes(tab.value))

  return (
    <div
      ref={rootRef}
      className="ostler-library"
      style={detailWidth.style}
      onDragEnter={(event) => {
        if (hasFiles(event)) setDragging(true)
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        setDragging(false)
        void importFiles([...event.dataTransfer.files])
      }}
    >
      {editor ? (
        <LibraryEditor
          key={editor.item?.id ?? `new-${editor.kind}-${editor.template ?? ''}-${editor.seq ?? 0}`}
          projectId={projectId}
          item={editor.item}
          kind={editor.kind}
          template={editor.template}
          onClose={closeEditor}
          replaceWithNew={pendingNewKind}
          onReplace={() => {
            if (pendingNewKind) setEditor({ kind: pendingNewKind, item: null, seq: Date.now() })
            setPendingNewKind(null)
          }}
          onKeepEditing={() => setPendingNewKind(null)}
          onSaved={(item) => {
            setEditor({ kind: editor.kind, item, seq: editor.seq })
            select(item.id)
            void reload()
          }}
        />
      ) : (
        <>
          <section
            className="ostler-library-centre"
            aria-label={t('library:libraryPanel.libraryItems')}
          >
            <div className="ostler-library-toolbar">
              <SearchField
                ref={searchRef}
                label={t('library:libraryPanel.searchLibrary')}
                className="ostler-library-search"
                placeholder={t('library:libraryPanel.searchLibrary2', {
                  keys: shortcut('library-search').keys
                })}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && search) {
                    event.stopPropagation()
                    setSearch('')
                  }
                }}
              />
              <LibraryTagFilter items={allItems} tag={tag} onTag={setTag} />
              {features.ai && (
                <LibraryAiFilter
                  items={allItems}
                  access={access}
                  onAccess={setAccess}
                  context={context}
                />
              )}
              <Menu
                label={t('library:libraryPanel.addLibrary')}
                placement="bottom-end"
                items={[
                  {
                    label: t('library:libraryPanel.newDesignBrief'),
                    onSelect: () => startNew('brief')
                  },
                  { label: t('library:libraryPanel.newGuide'), onSelect: () => startNew('guide') },
                  { label: t('library:libraryPanel.newNote'), onSelect: () => startNew('note') },
                  {
                    label: t('library:libraryPanel.newMeetingNotes'),
                    onSelect: () => startNew('note', 'meeting')
                  },
                  {
                    label: t('views:planView.whiteboards.new'),
                    onSelect: () => navigate(newWhiteboardPath(projectId))
                  },
                  { type: 'separator' },
                  {
                    label: t('library:libraryPanel.addLink'),
                    onSelect: () => setLinkModal({ item: null })
                  },
                  {
                    label: t('library:libraryPanel.importFiles'),
                    icon: Upload,
                    onSelect: () => void pickFiles()
                  },
                  {
                    label: t('library:libraryPanel.importClipboard'),
                    icon: ClipboardPaste,
                    onSelect: () => void importClipboard()
                  }
                ]}
                renderTrigger={(trigger) => (
                  <Button {...trigger} variant="primary" size="sm" icon={Plus}>
                    {t('library:libraryPanel.add')}
                  </Button>
                )}
              />
            </div>

            <Tabs
              label={t('library:libraryPanel.librarySections')}
              className="ostler-library-sections"
              ref={sectionBar}
              items={sectionTabs.filter((tab) => fits.includes(tab.value))}
              value={sectionValue}
              onChange={onSectionChange}
              trailing={
                overflowSections.length > 0 && (
                  <Menu
                    label={t('library:libraryPanel.moreSectionsMenu')}
                    placement="bottom-end"
                    items={overflowSections.map((tab) => ({
                      label: tab.label,
                      shortcut: String(tab.badge),
                      onSelect: () => onSectionChange(tab.value)
                    }))}
                    renderTrigger={(props) => (
                      <button {...props} type="button" className="ui-tabs__tab">
                        {t('library:libraryPanel.moreSections')}
                        <span
                          className="ui-tabs__badge"
                          aria-label={t('library:libraryPanel.sectionsInMore', {
                            count: overflowSections.length
                          })}
                        >
                          +{overflowSections.length}
                        </span>
                        <Icon icon={ChevronDown} />
                      </button>
                    )}
                  />
                )
              }
            />

            {notice && (
              <InlineAlert
                tone={notice.error ? 'danger' : 'info'}
                onDismiss={() => setNotice(null)}
              >
                {notice.text}
              </InlineAlert>
            )}

            <div className="ostler-library-scroll">
              {primary && (
                <div className="ostler-library-banner-wrap">
                  <Tick item={primary} selection={selection} />
                  <button
                    type="button"
                    data-library-item={primary.id}
                    className={`ostler-library-banner${primary.id === activeId ? ' active' : ''}${primary.id === focusedId ? ' focused' : ''}${selection.has(primary.id) ? ' selected' : ''}`}
                    onClick={(event) => activate(primary, event)}
                    onDoubleClick={() => open(primary)}
                  >
                    <span className="ostler-library-kicker">
                      {t('library:libraryPanel.primaryBrief')}
                    </span>
                    <span className="ostler-library-banner-title">{primary.title}</span>
                    {primary.summary && (
                      <span className="ostler-library-banner-summary">{primary.summary}</span>
                    )}
                  </button>
                </div>
              )}

              {loaded && visible.length === 0 ? (
                allItems.length === 0 ? (
                  <EmptyState
                    icon={Library}
                    headingLevel={3}
                    title={t('library:libraryPanel.libraryEmpty')}
                    description={t('library:libraryPanel.libraryKeepsBriefsGuides')}
                    action={
                      <Button variant="primary" icon={Plus} onClick={() => startNew('note')}>
                        {t('library:libraryPanel.writeNote')}
                      </Button>
                    }
                    secondaryAction={
                      <Button icon={Upload} onClick={() => void pickFiles()}>
                        {t('library:libraryPanel.importFiles')}
                      </Button>
                    }
                  />
                ) : (
                  <div className="ostler-library-muted ostler-library-nomatch">
                    {t('library:libraryPanel.nothingMatchesTheseFilters')}
                  </div>
                )
              ) : (
                <LibraryItemList
                  references={references}
                  rows={rows}
                  activeId={activeId}
                  focusedId={focusedId}
                  selection={selection}
                  onActivate={activate}
                  onOpen={open}
                />
              )}
            </div>

            {/* Below the list, so ticking an item never moves the rows. */}
            {selection.ids.length > 0 && (
              <div className="ostler-library-selection" role="status">
                <strong>
                  {t('library:libraryPanel.selected', { idCount: selection.ids.length })}
                </strong>
                <span className="ostler-library-selection-names" title={selectedNames.join(', ')}>
                  {selectedNames.join(', ')}
                </span>
                <Button variant="ghost" size="sm" onClick={selection.clear}>
                  {t('library:libraryPanel.clear')}
                </Button>
                {features.ai && (
                  <Button variant="ai" size="sm" icon={Sparkles} onClick={() => setPlanOpen(true)}>
                    {t('library:libraryPanel.planWorkThese')}
                  </Button>
                )}
              </div>
            )}
          </section>

          <div className="ostler-library-detail-pane">
            {detailWidth.handle}
            {activeItem ? (
              <LibraryDetail
                key={activeItem.id}
                item={activeItem}
                summaryRef={summaryRef}
                onUpdate={updateActive}
                onSetPrimary={setPrimary}
                onEdit={() => open(activeItem)}
                onOpen={() =>
                  activeItem.kind === 'whiteboard'
                    ? open(activeItem)
                    : void window.ostlerAPI
                        .openLibraryItemExternally(projectId, activeItem.id)
                        .then(report)
                }
                onArchive={archiveActive}
                onDelete={deleteActive}
                onOpenWorkItem={(workItemId) => navigate(taskPath(projectId, workItemId))}
              />
            ) : (
              <aside className="ostler-library-detail ostler-library-detail--empty">
                <span className="ostler-library-muted">
                  {t('library:libraryPanel.selectItemSeeDetails')}
                </span>
              </aside>
            )}
          </div>
        </>
      )}

      {linkModal && (
        <LibraryLinkModal
          projectId={projectId}
          item={linkModal.item}
          initialUrl={linkModal.initialUrl}
          onClose={() => setLinkModal(null)}
          onSaved={(item) => {
            setLinkModal(null)
            select(item.id)
            void reload()
          }}
        />
      )}

      {planOpen && (
        <LibraryPlanWorkModal
          projectId={projectId}
          items={selection.ids
            .map((id) => byId.get(id))
            .filter((item): item is LibraryItem => Boolean(item))}
          onClose={() => setPlanOpen(false)}
          onReady={(goal, sourceIds) => {
            setPlanOpen(false)
            // The plan wizard opens over Milestones, where its goal lives.
            navigate(
              projectPath(projectId, 'milestones', {
                agentPlan: goal.id,
                sources: sourceIds.join(',')
              })
            )
          }}
        />
      )}

      {dragging && (
        <div className="ostler-library-drop" aria-hidden="true">
          <div className="ostler-library-drop__card">
            <Icon icon={Upload} size="lg" />
            <strong>{t('library:libraryPanel.dropAddLibrary')}</strong>
            <span>{t('library:libraryPanel.filesImagesDocumentsCopied')}</span>
          </div>
        </div>
      )}
    </div>
  )
}
