import { useEffect, useRef, useState } from 'react'
import { Markdown } from '../../../ui/Markdown'
import { MEETING_NOTES_AI_ACCESS, type LibraryItem, type LibraryRevision } from '@shared/ostler-api'
import {
  libraryBriefTemplate,
  libraryGuideTemplate,
  libraryMeetingTemplate
} from '@shared/library-templates'
import { useDismissable } from '../../../hooks/useDismissable'
import { useItemLinkPicker } from '../../../hooks/useItemLinkPicker'
import { KIND_LABEL, relativeTime } from './libraryUi'
import {
  Button,
  ContextMenu,
  InlineAlert,
  SegmentedControl,
  TextField,
  useConfirm
} from '../../../ui'
import { ListChecks, ListPlus, RotateCcw } from '../../../ui/icons'
import { LiveListInsertDialog } from './LiveListInsertDialog'
import { selectedLineRange, type LineTaskMode } from '@shared/note-line-tasks'
import { resolveShortcut, shortcut } from '../../../navigation/shortcuts'
import {
  MakeLineTasksDialog,
  type MakeLineTasksRequest
} from '../../../components/line-tasks/MakeLineTasksDialog'
import { useWritingHelp, WritingHelpLayout } from '../../../components/WritingHelp'
import { t } from '@shared/i18n'

export type WrittenKind = 'brief' | 'guide' | 'note'
/** A starting text other than the kind's own: a note started as meeting notes. */
export type WrittenTemplate = 'meeting'

interface LibraryEditorProps {
  projectId: string
  /** Null when creating a new item of `kind`. */
  item: LibraryItem | null
  kind: WrittenKind
  /** A new item's starting text, when not the kind's own. */
  template?: WrittenTemplate | null
  onClose(): void
  onSaved(item: LibraryItem): void
  /**
   * A `?new=` link asking to replace this editor with a new item of this kind.
   * Unsaved changes hold it behind an in-page confirm.
   */
  replaceWithNew?: WrittenKind | null
  onReplace?(): void
  onKeepEditing?(): void
}

const TEMPLATES: Record<WrittenKind, string> = {
  get brief() {
    return libraryBriefTemplate()
  },
  get guide() {
    return libraryGuideTemplate()
  },
  note: ''
}

/**
 * The wide editor for briefs, guides and notes. It covers the centre and
 * detail panes; Save records a revision (the service keeps the last 20).
 */
export function LibraryEditor({
  projectId,
  item,
  kind,
  template = null,
  onClose,
  onSaved,
  replaceWithNew = null,
  onReplace,
  onKeepEditing
}: LibraryEditorProps) {
  const startingBody = template === 'meeting' ? libraryMeetingTemplate() : TEMPLATES[kind]
  const [title, setTitle] = useState(item?.title ?? '')
  const [body, setBody] = useState(item?.body ?? startingBody)
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const [revisions, setRevisions] = useState<LibraryRevision[]>([])
  const [sourceCount, setSourceCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [insertingList, setInsertingList] = useState(false)
  const [lineTasks, setLineTasks] = useState<MakeLineTasksRequest | null>(null)
  const confirm = useConfirm()
  const baseline = useRef({ title: item?.title ?? '', body: item?.body ?? startingBody })
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  // Improve writing (N8.2) reads the text as it is here, never on a Human only item.
  const writingHelp = useWritingHelp({
    projectId,
    target: { kind: 'library', itemId: item?.id ?? null },
    value: body,
    onChange: setBody,
    textRef: bodyRef,
    hidden: item?.aiAccess === 'human-only'
  })
  const bodyLinks = useItemLinkPicker({
    projectId,
    value: body,
    onChange: setBody,
    textRef: bodyRef
  })

  const dirty = title !== baseline.current.title || body !== baseline.current.body

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!item) return
    let cancelled = false
    void Promise.all([
      window.ostlerAPI.listLibraryRevisions(projectId, item.id),
      window.ostlerAPI.listItemWorkItems(projectId, item.id)
    ]).then(([revisionResult, sourceResult]) => {
      if (cancelled) return
      setRevisions(revisionResult.ok ? revisionResult.value : [])
      setSourceCount(sourceResult.ok ? sourceResult.value.length : 0)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, item?.id, item?.revision])

  // With nothing unsaved a replacement goes straight through; otherwise it
  // asks before throwing the edits away.
  useEffect(() => {
    if (!replaceWithNew || saving) return
    if (!dirty) {
      onReplace?.()
      return
    }
    let cancelled = false
    void confirm({
      title: t('library:libraryEditor.discardUnsavedChangesStart', {
        lowerCase: KIND_LABEL[replaceWithNew].toLowerCase()
      }),
      body: t('library:libraryEditor.editsOneLost'),
      confirmLabel: t('library:libraryEditor.discardStartNew'),
      cancelLabel: t('library:libraryEditor.keepEditing'),
      tone: 'danger'
    }).then((ok) => {
      if (cancelled) return
      if (ok) onReplace?.()
      else onKeepEditing?.()
    })
    return () => {
      cancelled = true
    }
  }, [replaceWithNew])

  const requestClose = async () => {
    if (saving) return
    if (dirty) {
      const ok = await confirm({
        title: t('library:libraryEditor.discardChanges'),
        body: t('library:libraryEditor.unsavedEditsLost'),
        confirmLabel: t('library:libraryEditor.discardChanges2'),
        cancelLabel: t('library:libraryEditor.keepEditing'),
        tone: 'danger'
      })
      if (!ok) return
    }
    onClose()
  }

  const dismissProps = useDismissable(() => void requestClose(), {
    canDismiss: !saving,
    closeOnBackdrop: false
  })

  const save = async () => {
    if (!title.trim()) {
      setError(t('library:libraryEditor.giveTitle'))
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = item
        ? await window.ostlerAPI.updateLibraryItem(projectId, item.id, {
            title: title.trim(),
            body
          })
        : await window.ostlerAPI.createLibraryItem(projectId, {
            kind,
            title: title.trim(),
            body,
            // Meeting notes start When selected, so Find actions works at once.
            ...(template === 'meeting' ? { aiAccess: MEETING_NOTES_AI_ACCESS } : {})
          })
      if (!result.ok) {
        setError(result.error)
        return
      }
      baseline.current = { title: result.value.title, body: result.value.body }
      // Main writes live lists' words lines again (N4.4c): show the saved text.
      setBody(result.value.body)
      onSaved(result.value)
    } finally {
      setSaving(false)
    }
  }

  /** Puts a live list's block (N4.4c) at the caret, on lines of its own. */
  const insertBlock = (block: string) => {
    const NL = '\n'
    const BLANK = '\n\n'
    setInsertingList(false)
    const at = bodyRef.current?.selectionEnd ?? body.length
    const before = body.slice(0, at)
    const after = body.slice(at)
    const lead = before === '' || before.endsWith(BLANK) ? '' : before.endsWith(NL) ? NL : BLANK
    const rest = after.startsWith(NL) ? after.slice(1) : after
    const trail = BLANK
    const next = before + lead + block + trail + rest
    setBody(next)
    setMode('write')
    const caret = (before + lead + block + trail).length
    requestAnimationFrame(() => {
      bodyRef.current?.focus()
      bodyRef.current?.setSelectionRange(caret, caret)
    })
  }

  /**
   * Make a task (N4.4b) from the lines the selection touches, in the text as
   * it is here, unsaved edits and all; the note must have been saved once.
   */
  const openLineTasks = (mode?: LineTaskMode) => {
    const text = bodyRef.current
    if (!item || !text) return
    const range = selectedLineRange(body, text.selectionStart, text.selectionEnd)
    setLineTasks({ body, ...range, mode: mode ?? 'each' })
  }

  /** The note as Make a task, or its undo, saved it: what this editor now holds. */
  const takeSaved = (saved: LibraryItem) => {
    baseline.current = { title: saved.title, body: saved.body }
    setBody(saved.body)
    onSaved(saved)
  }

  const restore = async (revision: number) => {
    if (!item) return
    setSaving(true)
    setError(null)
    try {
      const result = await window.ostlerAPI.restoreLibraryRevision(projectId, item.id, revision)
      if (!result.ok) {
        setError(result.error)
        return
      }
      baseline.current = { title: result.value.title, body: result.value.body }
      setTitle(result.value.title)
      setBody(result.value.body)
      onSaved(result.value)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="ostler-library-editor"
      role="dialog"
      aria-label={
        item
          ? t('library:libraryEditor.edit', { itemTitle: item.title })
          : t('library:libraryEditor.new', { lowerCase: KIND_LABEL[kind].toLowerCase() })
      }
      {...dismissProps}
      onKeyDown={(event) => {
        if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          void save()
        }
      }}
    >
      <header className="ostler-library-editor-header">
        <div className="ostler-library-kicker">
          {item
            ? t('library:libraryEditor.edit2', { lowerCase: KIND_LABEL[kind].toLowerCase() })
            : t('library:libraryEditor.new', { lowerCase: KIND_LABEL[kind].toLowerCase() })}
        </div>
        <TextField
          ref={titleRef}
          label={t('library:libraryEditor.title')}
          hideLabel
          inputClassName="ostler-library-editor-title"
          value={title}
          maxLength={200}
          placeholder={t('library:libraryEditor.title')}
          onChange={(event) => setTitle(event.target.value)}
        />
        {mode === 'write' && writingHelp.button}
        <Button variant="ghost" size="sm" icon={ListChecks} onClick={() => setInsertingList(true)}>
          {t('library:liveList.insert.button')}
        </Button>
        {mode === 'write' && (
          <Button
            variant="ghost"
            size="sm"
            icon={ListPlus}
            disabled={!item || saving}
            disabledReason={!item ? t('library:lineTasks.saveFirst') : undefined}
            aria-keyshortcuts="Control+Shift+K"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openLineTasks()}
          >
            {t('library:lineTasks.makeTask')}
          </Button>
        )}
        <SegmentedControl
          label={t('library:libraryEditor.editorMode')}
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'write', label: t('library:libraryEditor.write') },
            { value: 'preview', label: t('library:libraryEditor.preview') }
          ]}
        />
      </header>

      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      <div className="ostler-library-editor-body">
        {mode === 'write' ? (
          <WritingHelpLayout suggestion={writingHelp.suggestion}>
            <ContextMenu
              label={t('library:lineTasks.makeTask')}
              items={() =>
                item
                  ? [
                      {
                        label: t('library:lineTasks.one'),
                        icon: ListPlus,
                        onSelect: () => openLineTasks('one')
                      },
                      {
                        label: t('library:lineTasks.each'),
                        icon: ListPlus,
                        shortcut: shortcut('library-make-task').keys,
                        onSelect: () => openLineTasks('each')
                      }
                    ]
                  : []
              }
            >
              <textarea
                ref={bodyRef}
                className="ostler-library-editor-text"
                aria-label={t('library:libraryEditor.textMarkdown')}
                value={body}
                spellCheck
                placeholder={t('library:libraryEditor.writeHereMarkdownWorks')}
                onChange={(event) => setBody(event.target.value)}
                {...bodyLinks.inputProps}
                onContextMenu={(event) => {
                  // Nothing to offer before the note is saved: no menu at all.
                  if (!item) event.preventDefault()
                }}
                onKeyDown={(event) => {
                  bodyLinks.inputProps.onKeyDown?.(event)
                  if (event.defaultPrevented) return
                  const pressed = resolveShortcut(event.nativeEvent, null)
                  if (pressed && 'id' in pressed && pressed.id === 'library-make-task') {
                    event.preventDefault()
                    openLineTasks()
                  }
                }}
              />
            </ContextMenu>
            {bodyLinks.picker}
          </WritingHelpLayout>
        ) : (
          <div className="ostler-library-editor-preview ostler-library-markdown">
            {body.trim() ? (
              <Markdown projectId={projectId}>{body}</Markdown>
            ) : (
              <span className="ostler-library-muted">
                {t('library:libraryEditor.nothingPreview')}
              </span>
            )}
          </div>
        )}

        {item && (
          <aside
            className="ostler-library-revisions"
            aria-label={t('library:libraryEditor.revisions')}
          >
            <div className="ostler-library-kicker">{t('library:libraryEditor.revisions')}</div>
            {revisions.length === 0 && (
              <span className="ostler-library-muted">{t('library:libraryEditor.noneYet')}</span>
            )}
            {revisions.map((revision) => (
              <div key={revision.revision} className="ostler-library-revision">
                <span>
                  {t('library:libraryEditor.r', { revision: revision.revision })}
                  <span className="ostler-library-muted">
                    {' '}
                    · {relativeTime(revision.createdAt)}
                  </span>
                </span>
                {revision.revision === item.revision ? (
                  <span className="ostler-library-muted">{t('library:libraryEditor.current')}</span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={RotateCcw}
                    disabled={saving || dirty}
                    disabledReason={
                      dirty ? t('library:libraryEditor.saveDiscardEditsFirst') : undefined
                    }
                    onClick={() => void restore(revision.revision)}
                  >
                    {t('library:libraryEditor.restore')}
                  </Button>
                )}
              </div>
            ))}
          </aside>
        )}
      </div>

      <LiveListInsertDialog
        open={insertingList}
        projectId={projectId}
        onClose={() => setInsertingList(false)}
        onInsert={insertBlock}
      />
      {lineTasks && item && (
        <MakeLineTasksDialog
          item={item}
          request={lineTasks}
          onClose={() => {
            setLineTasks(null)
            bodyRef.current?.focus()
          }}
          onMade={takeSaved}
          onUndone={takeSaved}
        />
      )}

      <footer className="ostler-library-editor-footer">
        <span className="ostler-library-muted">
          {sourceCount > 0
            ? t('library:libraryEditor.savingMarksTasksChanged', { count: sourceCount })
            : dirty
              ? t('library:libraryEditor.unsavedChanges')
              : ''}
        </span>
        <Button variant="ghost" onClick={() => void requestClose()}>
          {t('library:libraryEditor.close')}
        </Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={saving || (!dirty && Boolean(item))}
          onClick={() => void save()}
        >
          {saving ? t('library:libraryEditor.saving') : t('library:libraryEditor.save')}
        </Button>
      </footer>
    </div>
  )
}
