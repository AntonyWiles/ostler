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
  Chip,
  Menu,
  SegmentedControl,
  Skeleton,
  TextArea,
  TextField,
  useConfirm
} from '../../../ui'
import { Archive, ExternalLink, ListPlus, Pencil, Presentation, Trash2 } from '../../../ui/icons'
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
import { ACCESS_OPTIONS, KIND_LABEL, libraryFileUrl, parseTags, relativeTime } from './libraryUi'
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
  onOpenWorkItem
}: LibraryDetailProps) {
  const ai = useFeatures().ai
  const [summary, setSummary] = useState(item.summary)
  const [tags, setTags] = useState(item.tags.join(', '))
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
    setTags(item.tags.join(', '))
  }, [item.id, item.summary, item.tags])

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
  const saveTags = () => {
    const next = parseTags(tags)
    if (next.join('\u0000') !== item.tags.join('\u0000')) void run(() => onUpdate({ tags: next }))
  }
  const setAccess = (aiAccess: LibraryAiAccess) => {
    if (aiAccess !== item.aiAccess) void run(() => onUpdate({ aiAccess }))
  }

  const isWhiteboard = item.kind === 'whiteboard'
  const canOpen = item.kind === 'link' ? Boolean(item.url) : Boolean(item.file)
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

      {ai && (
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
      )}

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
        hint={
          ai ? t('library:libraryDetail.summaryHintAi') : t('library:libraryDetail.summaryHint')
        }
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

      <TextField
        label={t('library:libraryDetail.tags')}
        value={tags}
        placeholder={t('library:libraryDetail.commaSeparated')}
        onChange={(event) => setTags(event.target.value)}
        onBlur={saveTags}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {item.tags.length > 0 && (
        <div className="ostler-library-chips" aria-label={t('library:libraryDetail.tagsItem')}>
          {item.tags.map((name) => (
            <Chip key={name}>#{name}</Chip>
          ))}
        </div>
      )}

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
        {pins.available && (
          <Menu
            label={t('library:libraryDetail.moreActions', { itemTitle: item.title })}
            placement="bottom-end"
            items={() =>
              pins.menuItems({
                kind: 'library',
                targetId: item.id,
                projectId: item.projectId,
                title: item.title
              })
            }
          />
        )}
      </div>
    </aside>
  )
}
