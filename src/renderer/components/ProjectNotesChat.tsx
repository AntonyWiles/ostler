import { useCallback, useEffect, useMemo, useState } from 'react'
import { Markdown } from '../ui/Markdown'
import { extractProposals, stripProposalBlocks } from '@shared/ostler-api'
import type { AIConversation, AIMessage, LibraryItem } from '@shared/ostler-api'
import { useConfig } from '../hooks/useConfig'
import { Button, Card, Chip, IconButton, InlineAlert, TextArea, useConfirm } from '../ui'
import { Paperclip, Plus, Trash2 } from '../ui/icons'
import { libraryFileUrl } from '../views/project-detail/library/libraryUi'
import { LibraryAttachPicker } from './LibraryAttachPicker'
import { useStickToBottom } from '../hooks/useStickToBottom'
import { isChatSendShortcut } from '../utils/chatSendKey'
import { EMPTY_TRACKED_PLANNING, ProposalCards, type TrackedPlanning } from './ProjectChatProposals'
import './ProjectNotesChat.css'
import { t } from '@shared/i18n'

interface ProjectNotesChatProps {
  projectId: string
  projectName: string
  onStatusSaved: () => void
}

/** Project-scoped chat history and human-approved status-note export. */
export function ProjectNotesChat({ projectId, projectName, onStatusSaved }: ProjectNotesChatProps) {
  const { config } = useConfig()
  const sendMessageOn = config?.ui.sendMessageOn ?? 'ctrlEnter'
  const confirm = useConfirm()
  const [conversations, setConversations] = useState<AIConversation[]>([])
  const [conversation, setConversation] = useState<AIConversation | null>(null)
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [tracked, setTracked] = useState<TrackedPlanning>(EMPTY_TRACKED_PLANNING)
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([])
  const [attachedIds, setAttachedIds] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [visionWarning, setVisionWarning] = useState<string | null>(null)
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null)
  const {
    ref: messagesPaneRef,
    onScroll: onMessagesScroll,
    scrollToBottom: followMessages
  } = useStickToBottom<HTMLDivElement>(
    useMemo(() => ({ messages, streaming }), [messages, streaming])
  )

  // What Planning already holds, so a suggestion that is already there says so
  // instead of offering a duplicate Add.
  const loadTracked = useCallback(async () => {
    const [goals, milestones, workItems] = await Promise.all([
      window.ostlerAPI.getPlanningGoals(projectId),
      window.ostlerAPI.getPlanningMilestones(projectId),
      window.ostlerAPI.getPlanningWorkItems(projectId)
    ])
    setTracked({
      goals: new Set(goals.ok ? goals.value.map((goal) => goal.title.toLowerCase()) : []),
      milestones: new Map(
        milestones.ok
          ? milestones.value.map((milestone) => [milestone.name.toLowerCase(), milestone.id])
          : []
      ),
      workItems: new Set(
        workItems.ok ? workItems.value.map((item) => item.title.toLowerCase()) : []
      )
    })
  }, [projectId])

  useEffect(() => {
    void loadTracked()
  }, [loadTracked])

  // Archived items too, so chips on older messages still show their title.
  const loadLibrary = useCallback(async () => {
    const result = await window.ostlerAPI.listLibraryItems(projectId, { includeArchived: true })
    if (result.ok) setLibraryItems(result.value)
  }, [projectId])

  useEffect(() => {
    void loadLibrary()
    setAttachedIds([])
  }, [loadLibrary])

  const libraryById = useMemo(
    () => new Map(libraryItems.map((item) => [item.id, item])),
    [libraryItems]
  )

  const loadConversations = useCallback(async () => {
    const result = await window.ostlerAPI.getConversations()
    if (!result.ok) {
      setError(result.error)
      return []
    }
    const projectConversations = result.value.filter((item) => item.projectId === projectId)
    setConversations(projectConversations)
    return projectConversations
  }, [projectId])

  useEffect(() => {
    let active = true
    const load = async () => {
      const projectConversations = await loadConversations()
      if (!active) return
      const existing = projectConversations[0] || null
      setConversation(existing)
      setMessages(existing?.messages || [])
    }
    void load()
    return () => {
      active = false
    }
  }, [loadConversations])

  useEffect(() => {
    const unsubscribe = window.ostlerAPI.onAIStreamChunk((chunk) => {
      if (!conversation || chunk.conversationId !== conversation.id) return
      if (chunk.done) {
        setStreaming(false)
        setVisionWarning(chunk.warning ?? null)
        void loadConversations()
        return
      }
      setMessages((previous) => {
        const last = previous[previous.length - 1]
        if (last?.role === 'assistant') {
          return [...previous.slice(0, -1), { ...last, content: last.content + chunk.content }]
        }
        return [...previous, { role: 'assistant', content: chunk.content, timestamp: Date.now() }]
      })
    })
    return unsubscribe
  }, [conversation, loadConversations])

  const createConversation = async () => {
    if (streaming) return
    setError(null)
    setSavedPath(null)
    const result = await window.ostlerAPI.createConversation(
      t('ai:projectNotesChat.notes', { projectName }),
      projectId
    )
    if (!result.ok) {
      setError(result.error)
      return
    }
    await loadConversations()
    setConversation(result.value)
    setMessages([])
  }

  const selectConversation = (selected: AIConversation) => {
    if (streaming) return
    setConversation(selected)
    setMessages(selected.messages)
    setError(null)
    setSavedPath(null)
  }

  const deleteConversation = async (selected: AIConversation) => {
    if (streaming) return
    const ok = await confirm({
      title: t('ai:projectNotesChat.deleteChat', { selectedTitle: selected.title }),
      body: t('ai:projectNotesChat.conversationMessagesDeletedPermanently'),
      confirmLabel: t('ai:projectNotesChat.deleteChat2'),
      tone: 'danger'
    })
    if (!ok) return
    const result = await window.ostlerAPI.deleteConversation(selected.id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const remaining = await loadConversations()
    if (conversation?.id === selected.id) {
      const next = remaining[0] || null
      setConversation(next)
      setMessages(next?.messages || [])
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || !conversation || streaming) return
    const selectedItemIds = attachedIds
    setInput('')
    setAttachedIds([])
    setPickerOpen(false)
    setError(null)
    setSavedPath(null)
    setVisionWarning(null)
    setLibraryNotice(null)
    setStreaming(true)
    // Sending is an explicit "I am back": follow the reply even if the reader
    // had scrolled up to re-read something.
    followMessages()
    // Shown at once; the stored message (reloaded when the reply finishes)
    // carries the revisions main actually attached.
    const attachments = selectedItemIds.flatMap((id) => {
      const item = libraryById.get(id)
      return item ? [{ libraryItemId: item.id, revision: item.revision }] : []
    })
    setMessages((previous) => [
      ...previous,
      {
        role: 'user',
        content: text,
        timestamp: Date.now(),
        ...(attachments.length > 0 ? { attachments } : {})
      }
    ])
    const result = await window.ostlerAPI.sendMessage(
      conversation.id,
      text,
      projectId,
      selectedItemIds
    )
    if (!result.ok) {
      setError(result.error)
      setStreaming(false)
    }
  }

  const toggleAttached = (item: LibraryItem) => {
    setAttachedIds((previous) =>
      previous.includes(item.id) ? previous.filter((id) => id !== item.id) : [...previous, item.id]
    )
  }

  // A human click: the reply becomes a note, human-only like every new note.
  const saveToLibrary = async (message: AIMessage) => {
    const body = stripProposalBlocks(message.content).trim()
    if (!body) return
    setError(null)
    setLibraryNotice(null)
    const firstLine = body
      .split('\n')
      .map((line) => line.replace(/^#+\s*|[*_`]/g, '').trim())
      .find(Boolean)
    const title = (firstLine || t('ai:projectNotesChat.chatNote', { projectName })).slice(0, 120)
    const result = await window.ostlerAPI.createLibraryItem(projectId, {
      kind: 'note',
      title,
      body
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setLibraryNotice(t('ai:projectNotesChat.savedLibraryNote', { valueTitle: result.value.title }))
    void loadLibrary()
  }

  const saveLatestStatus = async () => {
    const latest = [...messages].reverse().find((message) => message.role === 'assistant')
    if (!latest) return
    setError(null)
    const result = await window.ostlerAPI.saveProjectStatusNote(
      projectId,
      stripProposalBlocks(latest.content)
    )
    if (result.ok) {
      setSavedPath(result.value)
      onStatusSaved()
    } else setError(result.error)
  }

  return (
    <Card
      padding="none"
      as="section"
      className="notes-chat"
      aria-label={t('ai:projectNotesChat.projectNotesChat')}
    >
      <aside
        className="notes-chat__history"
        aria-label={t('ai:projectNotesChat.projectChatHistory')}
      >
        <Button
          size="sm"
          icon={Plus}
          onClick={() => void createConversation()}
          disabled={streaming}
        >
          {t('ai:projectNotesChat.newChat')}
        </Button>
        <ul className="notes-chat__history-list">
          {conversations.length === 0 && (
            <li className="notes-chat__muted">{t('ai:projectNotesChat.noChatsYet')}</li>
          )}
          {conversations.map((item) => (
            <li
              key={item.id}
              className={`notes-chat__history-item${conversation?.id === item.id ? ' is-active' : ''}`}
            >
              <button
                type="button"
                className="notes-chat__history-open"
                aria-current={conversation?.id === item.id || undefined}
                onClick={() => selectConversation(item)}
                disabled={streaming}
                title={item.title}
              >
                {item.title}
              </button>
              <IconButton
                label={t('ai:projectNotesChat.delete', { itemTitle: item.title })}
                icon={Trash2}
                size="sm"
                onClick={() => void deleteConversation(item)}
                disabled={streaming}
              />
            </li>
          ))}
        </ul>
      </aside>
      <div className="notes-chat__main">
        <div className="notes-chat__heading">
          <div>
            <h3>{conversation?.title || t('ai:projectNotesChat.projectNotes')}</h3>
            <p className="notes-chat__muted">{t('ai:projectNotesChat.askAboutProjectThen')}</p>
          </div>
          <Button
            size="sm"
            onClick={() => void saveLatestStatus()}
            disabled={streaming || !messages.some((m) => m.role === 'assistant')}
            disabledReason={t('ai:projectNotesChat.waitReplySave')}
          >
            {t('ai:projectNotesChat.saveLatestStatus')}
          </Button>
        </div>
        <div ref={messagesPaneRef} onScroll={onMessagesScroll} className="notes-chat__messages">
          {!conversation && (
            <p className="notes-chat__muted">{t('ai:projectNotesChat.startNewChatBegin')}</p>
          )}
          {conversation && messages.length === 0 && (
            <p className="notes-chat__muted">{t('ai:projectNotesChat.startNoteQuestionStatus')}</p>
          )}
          {messages.map((message, index) => {
            const isAssistant = message.role === 'assistant'
            // Cards wait for the reply to finish so they do not shuffle in mid-stream.
            const finished = !(streaming && index === messages.length - 1)
            const proposals = isAssistant && finished ? extractProposals(message.content) : []
            return (
              <div
                key={`${message.timestamp}-${index}`}
                className={`notes-chat__message notes-chat__message--${message.role}`}
              >
                <div className="notes-chat__bubble">
                  {isAssistant ? (
                    <Markdown>{stripProposalBlocks(message.content)}</Markdown>
                  ) : (
                    message.content
                  )}
                  {message.attachments && message.attachments.length > 0 && (
                    <ul
                      className="notes-chat__attachments"
                      aria-label={t('ai:projectNotesChat.attachedLibrary')}
                    >
                      {message.attachments.map((attachment) => {
                        const item = libraryById.get(attachment.libraryItemId)
                        return (
                          <li
                            key={attachment.libraryItemId}
                            className="notes-chat__attachment"
                            title={
                              item
                                ? t('ai:projectNotesChat.revision', {
                                    itemTitle: item.title,
                                    revision: attachment.revision
                                  })
                                : t('ai:projectNotesChat.removedLibrary')
                            }
                          >
                            {item?.file?.hasThumbnail && (
                              <img src={libraryFileUrl(item, 'thumb')} alt="" />
                            )}
                            <span>{item?.title ?? t('ai:projectNotesChat.removedItem')}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {proposals.length > 0 && (
                    <ProposalCards
                      projectId={projectId}
                      proposals={proposals}
                      tracked={tracked}
                      onAdded={() => void loadTracked()}
                    />
                  )}
                  {isAssistant && finished && (
                    <div className="notes-chat__message-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void saveToLibrary(message)}
                        title={t('ai:projectNotesChat.saveReplyLibraryHuman')}
                      >
                        {t('ai:projectNotesChat.saveLibrary')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {streaming && (
            <p className="notes-chat__muted" role="status">
              {t('ai:projectNotesChat.writing')}
            </p>
          )}
        </div>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {visionWarning && <InlineAlert tone="warning">{visionWarning}</InlineAlert>}
        {libraryNotice && <InlineAlert tone="success">{libraryNotice}</InlineAlert>}
        {savedPath && (
          <InlineAlert tone="success">
            {t('ai:projectNotesChat.savedOutsideProject', { savedPath })}
          </InlineAlert>
        )}
        {attachedIds.length > 0 && (
          <ul
            className="notes-chat__attachments"
            aria-label={t('ai:projectNotesChat.attachedNextMessage')}
          >
            {attachedIds.map((id) => {
              const item = libraryById.get(id)
              return (
                <li key={id}>
                  <Chip
                    removeLabel={item?.title ?? t('ai:projectNotesChat.attachment')}
                    onRemove={() =>
                      setAttachedIds((previous) => previous.filter((entry) => entry !== id))
                    }
                  >
                    {item?.title ?? id}
                  </Chip>
                </li>
              )
            })}
          </ul>
        )}
        <div className="notes-chat__composer">
          <TextArea
            label={t('ai:projectNotesChat.message')}
            hideLabel
            rows={2}
            maxRows={8}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              sendMessageOn === 'enter'
                ? t('ai:projectNotesChat.addNoteAskAbout')
                : t('ai:projectNotesChat.addNoteAskAbout2')
            }
            disabled={!conversation || streaming}
            onKeyDown={(event) => {
              if (isChatSendShortcut(event, sendMessageOn)) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <div className="notes-chat__composer-actions">
            <div className="notes-chat__attach">
              <Button
                size="sm"
                variant="ghost"
                icon={Paperclip}
                onClick={() => {
                  if (!pickerOpen) void loadLibrary()
                  setPickerOpen((open) => !open)
                }}
                disabled={!conversation || streaming}
                aria-expanded={pickerOpen}
                title={t('ai:projectNotesChat.attachLibraryItemsNext')}
              >
                {attachedIds.length > 0
                  ? t('ai:projectNotesChat.attachLibraryCount', { count: attachedIds.length })
                  : t('ai:projectNotesChat.attachLibrary')}
              </Button>
              {pickerOpen && (
                <LibraryAttachPicker
                  items={libraryItems}
                  selectedIds={attachedIds}
                  onToggle={toggleAttached}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
            <Button
              variant="primary"
              onClick={() => void send()}
              disabled={!conversation || streaming || !input.trim()}
            >
              {t('ai:projectNotesChat.send')}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
