import { useCallback, useEffect, useState, type RefObject } from 'react'
import { Markdown } from '../../../ui/Markdown'
import { LinkedFrom } from '../../../components/LinkedFrom'
import { usePins } from '../../../pins/PinsProvider'
import type {
  LibraryAiAccess,
  LibraryItem,
  LibraryItemAttachmentLink,
  LibraryItemSourceLink,
  UpdateLibraryItemInput
} from '@shared/ostler-api'
import {
  Badge,
  Button,
  Checkbox,
  Menu,
  SegmentedControl,
  Skeleton,
  TextArea,
  useConfirm
} from '../../../ui'
import {
  Archive,
  Copy,
  ExternalLink,
  FolderOpen,
  ListPlus,
  Pencil,
  Presentation,
  Trash2
} from '../../../ui/icons'
import type { MenuEntry } from '../../../ui/Menu'
import { IconButton } from '../../../ui/IconButton'
import { isTaskableLine, noteLineParts, noteLines } from '@shared/note-line-tasks'
import {
  MakeLineTasksDialog,
  type MakeLineTasksRequest
} from '../../../components/line-tasks/MakeLineTasksDialog'
import { ATTACHED_BY_LABEL } from '../../planning/useWorkItemAttachments'
import { NoteActionsButton } from '../../../components/note-actions/NoteActionsDialog'
import { MarkUpCopyButton } from '../../../components/markup/MarkUpCopyButton'
import { CloudFileLine } from './CloudFileLine'
import { LibraryWhiteboardPreview } from './LibraryWhiteboardPreview'
import { LibraryPdfPreview } from './LibraryPdfPreview'
import { ACCESS_OPTIONS, KIND_LABEL, libraryFileUrl, relativeTime } from './libraryUi'
import { LibraryTagsField } from './LibraryTagsField'
import { t } from '@shared/i18n'
import { useFeatures } from '../../../navigation/features'
import { formatFileSize, formatNumber } from '@shared/format'

const PREVIEW_CHARS = 4000

function isWrittenKind(kind: LibraryItem['kind']): boolean {
  return kind === 'note' || kind === 'brief' || kind === 'guide'
}

function isMarkdownFile(fileName: string): boolean {
  return /\.(md|markdown)$/i.test(fileName)
}

interface LibraryDetailProps {
  item: LibraryItem
  summaryRef: RefObject<HTMLTextAreaElement | null>
  onUpdate(updates: UpdateLibraryItemInput): Promise<void>
  onSetPrimary(primary: boolean): Promise<void>
  onEdit(): void
  /** Opens the file or link; a whiteboard opens in the Plan. */
  onOpen(): void
  onArchive(): Promise<void>
  onDelete(): Promise<void>
  /** Opens a work item this item is a source of, in the Planning drawer. */
  onOpenWorkItem(workItemId: string): void
  /** Shows a short message in the Library's notice line. */
  onNotice(text: string, error?: boolean): void
}

export function LibraryDetail({
  item,
  summaryRef,
  onUpdate,
  onSetPrimary,
  onEdit,
  onOpen,
  onArchive,
  onDelete,
  onOpenWorkItem,
  onNotice
}: LibraryDetailProps) {
  const ai = useFeatures().ai
  const [summary, setSummary] = useState(item.summary)
  const [documentText, setDocumentText] = useState<string | null>(null)
  const [sourceOf, setSourceOf] = useState<LibraryItemSourceLink[]>([])
  const [attachedTo, setAttachedTo] = useState<LibraryItemAttachmentLink[]>([])
  const confirm = useConfirm()
  const pins = usePins()
  const [busy, setBusy] = useState(false)
  const [lineTasks, setLineTasks] = useState<MakeLineTasksRequest | null>(null)
  const canMakeTasks = isWrittenKind(item.kind) && !item.archivedAt
  // View mode's Make a task (N4.4b): one task from one list item.
  const listItemAction = useCallback(
    (line: number) => {
      const text = noteLines(item.body)[line]
      if (text === undefined || !isTaskableLine(text)) return null
      return (
        <IconButton
          size="sm"
          icon={ListPlus}
          label={t('library:lineTasks.makeTaskFromItem', {
            words: noteLineParts(text).words.trim()
          })}
          onClick={() => setLineTasks({ body: item.body, from: line, to: line, mode: 'each' })}
        />
      )
    },
    [item.body]
  )

  useEffect(() => {
    setSummary(item.summary)
  }, [item.id, item.summary])

  // "Source of" and "Attached to" follow the links, not just this item: a work
  // item linked, attached, renamed or deleted elsewhere pushes 'library' or
  // 'planning' for the project, and each push reloads both lists.
  useEffect(() => {
    let cancelled = false
    let request = 0
    const load = () => {
      const current = ++request
      void Promise.all([
        window.ostlerAPI.listItemWorkItems(item.projectId, item.id),
        window.ostlerAPI.listItemAttachments(item.projectId, item.id)
      ]).then(([sources, attachments]) => {
        if (cancelled || current !== request) return
        setSourceOf(sources.ok ? sources.value : [])
        setAttachedTo(attachments.ok ? attachments.value : [])
      })
    }
    load()
    const unsubscribe = window.ostlerAPI.onProjectStateChange((state) => {
      if (state.projectId !== item.projectId) return
      if (state.field === 'library' || state.field === 'planning') load()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [item.projectId, item.id, item.revision])

  useEffect(() => {
    setDocumentText(null)
    if (item.kind !== 'document') return
    let cancelled = false
    void window.ostlerAPI.getLibraryItemText(item.projectId, item.id).then((result) => {
      if (!cancelled) setDocumentText(result.ok ? result.value : '')
    })
    return () => {
      cancelled = true
    }
  }, [item.projectId, item.id, item.kind, item.revision])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const saveSummary = () => {
    if (summary.trim() !== item.summary) void run(() => onUpdate({ summary: summary.trim() }))
  }
  const saveTags = (next: string[]) => {
    if (next.join('\u0000') !== item.tags.join('\u0000')) void run(() => onUpdate({ tags: next }))
  }
  const setAccess = (aiAccess: LibraryAiAccess) => {
    if (aiAccess !== item.aiAccess) void run(() => onUpdate({ aiAccess }))
  }

  const isWhiteboard = item.kind === 'whiteboard'
  const canOpen = item.kind === 'link' ? Boolean(item.url) : Boolean(item.file)
  const hasFile = Boolean(item.file)
  const showInFolder = async () => {
    const result = await window.ostlerAPI.showLibraryItemInFolder(item.projectId, item.id)
    if (!result.ok) onNotice(result.error, true)
  }
  const copy = async (text: string, done: string) => {
    const result = await window.ostlerAPI.copyText(text)
    onNotice(result.ok ? done : result.error, !result.ok)
  }
  const copyPath = async () => {
    const path = await window.ostlerAPI.getLibraryItemFilePath(item.projectId, item.id)
    if (path.ok) await copy(path.value, t('library:libraryDetail.pathCopied'))
    else onNotice(path.error, true)
  }
  // Open, Show in folder and Copy path/link: the item's ⋯ menu, ahead of pinning.
  const fileMenu: MenuEntry[] = []
  if (canOpen)
    fileMenu.push({
      label:
        item.kind === 'link'
          ? t('library:libraryDetail.openLink')
          : t('library:libraryDetail.open'),
      icon: ExternalLink,
      onSelect: onOpen
    })
  if (hasFile)
    fileMenu.push(
      {
        label: t('library:libraryDetail.showInFolder'),
        icon: FolderOpen,
        onSelect: () => void showInFolder()
      },
      { label: t('library:libraryDetail.copyPath'), icon: Copy, onSelect: () => void copyPath() }
    )
  if (item.kind === 'link' && item.url) {
    const url = item.url
    fileMenu.push({
      label: t('library:libraryDetail.copyLink'),
      icon: Copy,
      onSelect: () => void copy(url, t('library:libraryDetail.linkCopied'))
    })
  }
  // A whiteboard is edited only in the Plan: Open whiteboard, never Edit.
  const canEdit = item.kind !== 'image' && item.kind !== 'document' && !isWhiteboard
  const isPdf = item.file?.mimeType === 'application/pdf'
  const shownText =
    documentText && documentText.length > PREVIEW_CHARS
      ? `${documentText.slice(0, PREVIEW_CHARS)}…`
      : documentText
  // A document's text: a Markdown file drawn as Markdown, anything else as it reads.
  const documentPreview =
    shownText === null ? (
      <Skeleton lines={4} />
    ) : !shownText ? (
      <pre className="ostler-library-document-text">
        {t('library:libraryDetail.noReadableTextOpen')}
      </pre>
    ) : isMarkdownFile(item.file?.fileName ?? '') ? (
      <div className="ostler-library-markdown">
        <Markdown projectId={item.projectId}>{shownText}</Markdown>
      </div>
    ) : (
      <pre className="ostler-library-document-text">{shownText}</pre>
    )

  return (
    <aside className="ostler-library-detail" aria-label={t('library:libraryDetail.libraryItem')}>
      <div className="ostler-library-kicker">{KIND_LABEL[item.kind]}</div>
      <h2 className="ostler-library-detail-title">{item.title}</h2>
      {item.archivedAt && (
        <div>
          <Badge tone="warning" icon={Archive}>
            {t('library:libraryDetail.archived')}
          </Badge>
        </div>
      )}

      <div className="ostler-library-preview">
        {item.kind === 'image' && item.file && (
          <img src={libraryFileUrl(item, 'file')} alt={item.title} />
        )}
        {item.kind === 'link' && item.url && (
          <div className="ostler-library-link-url" title={item.url}>
            {item.url}
          </div>
        )}
        {item.kind === 'link' && item.url && (
          <CloudFileLine item={item} onRename={(title) => void run(() => onUpdate({ title }))} />
        )}
        {isWhiteboard && <LibraryWhiteboardPreview item={item} />}
        {item.kind !== 'document' && !isWhiteboard && item.body.trim() && (
          <div className="ostler-library-markdown">
            <Markdown
              projectId={item.projectId}
              listItemAction={canMakeTasks ? listItemAction : undefined}
            >
              {item.body.length > PREVIEW_CHARS
                ? `${item.body.slice(0, PREVIEW_CHARS)}…`
                : item.body}
            </Markdown>
          </div>
        )}
        {item.kind === 'document' &&
          (isPdf ? <LibraryPdfPreview item={item} fallback={documentPreview} /> : documentPreview)}
      </div>

      {lineTasks && (
        <MakeLineTasksDialog
          item={item}
          request={lineTasks}
          onClose={() => setLineTasks(null)}
          onMade={() => undefined}
        />
      )}

      <LinkedFrom kind="library" id={item.id} refreshKey={item.updatedAt} />

      {item.kind === 'brief' && (
        <Checkbox
          label={t('library:libraryDetail.primaryBriefProject')}
          checked={item.isPrimaryBrief}
          disabled={busy || Boolean(item.archivedAt)}
          onChange={(event) => void run(() => onSetPrimary(event.target.checked))}
        />
      )}

      <TextArea
        label={t('library:libraryDetail.summary')}
        hint={t('library:libraryDetail.summaryHint')}
        ref={summaryRef}
        rows={2}
        value={summary}
        maxLength={500}
        placeholder={t('library:libraryDetail.oneLineEG')}
        onChange={(event) => setSummary(event.target.value)}
        onBlur={saveSummary}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
      />

      <LibraryTagsField
        projectId={item.projectId}
        tags={item.tags}
        disabled={busy}
        onChange={saveTags}
      />

      <NoteActionsButton projectId={item.projectId} item={item} />

      <div className="ostler-library-field">
        <span className="ostler-library-field-label">{t('library:libraryDetail.source')}</span>
        {sourceOf.length === 0 ? (
          <span className="ostler-library-muted">{t('library:libraryDetail.noTasksYet')}</span>
        ) : (
          <ul className="ostler-library-links">
            {sourceOf.map((link) => (
              <li key={link.workItemId}>
                <button
                  type="button"
                  className="ostler-library-link-button"
                  title={t('library:libraryDetail.openTask')}
                  onClick={() => onOpenWorkItem(link.workItemId)}
                >
                  {link.workItemTitle || t('library:libraryDetail.untitledTask')}
                </button>
                {link.changedSince && (
                  <Badge tone="warning">
                    {t('library:libraryDetail.rR', {
                      revisionAtLink: link.revisionAtLink,
                      currentRevision: link.currentRevision
                    })}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ostler-library-field">
        <span className="ostler-library-field-label">{t('library:libraryDetail.attached')}</span>
        {attachedTo.length === 0 ? (
          <span className="ostler-library-muted">
            {t('library:libraryDetail.notAttachedAnyTask')}
          </span>
        ) : (
          <ul className="ostler-library-links">
            {attachedTo.map((link) => (
              <li key={link.workItemId}>
                <button
                  type="button"
                  className="ostler-library-link-button"
                  title={t('library:libraryDetail.openTask')}
                  onClick={() => onOpenWorkItem(link.workItemId)}
                >
                  {link.workItemCode && (
                    <span className="ostler-library-muted">{link.workItemCode} </span>
                  )}
                  {link.workItemTitle || t('library:libraryDetail.untitledTask')}
                </button>
                <span className="ostler-library-muted">
                  {t('library:libraryDetail.r', {
                    ATTACHED_BY_LABEL: ATTACHED_BY_LABEL[link.attachedBy],
                    revisionAtAttach: link.revisionAtAttach
                  })}
                </span>
                {link.changedSince && (
                  <Badge tone="warning">
                    {t('library:libraryDetail.changedSinceR', {
                      currentRevision: link.currentRevision
                    })}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <dl className="ostler-library-info">
        {item.file && (
          <>
            <dt>{t('library:libraryDetail.file')}</dt>
            <dd title={item.file.fileName}>{item.file.fileName}</dd>
            <dt>{t('library:libraryDetail.type')}</dt>
            <dd>
              {item.file.mimeType} · {formatFileSize(item.file.sizeBytes)}
            </dd>
            {item.file.width && item.file.height && (
              <>
                <dt>{t('library:libraryDetail.size')}</dt>
                <dd>
                  {item.file.width} × {item.file.height}
                </dd>
              </>
            )}
            {item.file.pageCount !== undefined && (
              <>
                <dt>{t('library:libraryDetail.pages')}</dt>
                <dd>{item.file.pageCount}</dd>
              </>
            )}
            {item.file.textUnreadable && (
              <>
                <dt>{t('library:libraryDetail.text')}</dt>
                <dd>{t('library:libraryDetail.couldNotReadText')}</dd>
              </>
            )}
            {item.file.extractedChars !== undefined && !item.file.textUnreadable && (
              <>
                <dt>{t('library:libraryDetail.text')}</dt>
                <dd>
                  {t('library:libraryDetail.chars', {
                    localeString: formatNumber(item.file.extractedChars)
                  })}
                </dd>
              </>
            )}
          </>
        )}
        <dt>{t('library:libraryDetail.revision')}</dt>
        <dd>{t('library:libraryDetail.r2', { revision: item.revision })}</dd>
        <dt>{t('library:libraryDetail.updated')}</dt>
        <dd title={item.updatedAt}>{relativeTime(item.updatedAt)}</dd>
      </dl>

      <div className="ostler-library-actions">
        {isWhiteboard && (
          <Button variant="primary" size="sm" icon={Presentation} onClick={onOpen}>
            {t('library:libraryDetail.openWhiteboard')}
          </Button>
        )}
        {canEdit && (
          <Button variant="secondary" size="sm" icon={Pencil} onClick={onEdit}>
            {t('library:libraryDetail.edit')}
          </Button>
        )}
        {canOpen && (
          <Button variant="secondary" size="sm" icon={ExternalLink} onClick={onOpen}>
            {item.kind === 'link'
              ? t('library:libraryDetail.openLink')
              : t('library:libraryDetail.open')}
          </Button>
        )}
        {hasFile && (
          <Button
            variant="secondary"
            size="sm"
            icon={FolderOpen}
            onClick={() => void showInFolder()}
          >
            {t('library:libraryDetail.showInFolder')}
          </Button>
        )}
        {!item.archivedAt && <MarkUpCopyButton item={item} />}
        <Button
          variant="ghost"
          size="sm"
          icon={Archive}
          disabled={busy}
          onClick={() => void run(onArchive)}
        >
          {item.archivedAt
            ? t('library:libraryDetail.unarchive')
            : t('library:libraryDetail.archive')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={Trash2}
          className="ostler-library-danger"
          disabled={busy}
          onClick={async () => {
            const ok = await confirm({
              title: t('library:libraryDetail.delete2', { itemTitle: item.title }),
              body: t('library:libraryDetail.permanentlyRemovesItemRevisions'),
              confirmLabel: t('library:libraryDetail.deleteItem'),
              tone: 'danger'
            })
            if (ok) void run(onDelete)
          }}
        >
          {t('library:libraryDetail.delete')}
        </Button>
        {(pins.available || fileMenu.length > 0) && (
          <Menu
            label={t('library:libraryDetail.moreActions', { itemTitle: item.title })}
            placement="bottom-end"
            items={() => {
              const pinItems = pins.available
                ? pins.menuItems({
                    kind: 'library',
                    targetId: item.id,
                    projectId: item.projectId,
                    title: item.title
                  })
                : []
              return fileMenu.length > 0 && pinItems.length > 0
                ? [...fileMenu, { type: 'separator' as const }, ...pinItems]
                : [...fileMenu, ...pinItems]
            }}
          />
        )}
      </div>

      {ai && (
        <details className="ostler-library-ai-section">
          <summary>{t('library:libraryDetail.aiSection')}</summary>
          <div className="ostler-library-field">
            <span className="ostler-library-field-label" aria-hidden="true">
              {t('library:libraryDetail.ostlerAiAccess')}
            </span>
            <SegmentedControl
              label={t('library:libraryDetail.ostlerAiAccess')}
              size="sm"
              value={item.aiAccess}
              onChange={setAccess}
              options={ACCESS_OPTIONS.map((option) => ({
                value: option.id,
                label: option.label,
                disabled: busy
              }))}
            />
          </div>
        </details>
      )}
    </aside>
  )
}
