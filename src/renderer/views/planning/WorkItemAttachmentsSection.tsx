import { useState } from 'react'
import type { LibraryItem, PlanningWorkItem } from '@shared/ostler-api'
import { LIBRARY_MAX_TASK_ATTACHMENTS } from '@shared/ostler-api'
import { LibraryAttachPicker } from '../../components/LibraryAttachPicker'
import { KIND_LABEL, libraryFileUrl } from '../project-detail/library/libraryUi'
import { ATTACHED_BY_LABEL, useWorkItemAttachments } from './useWorkItemAttachments'
import { Badge, Button, IconButton, InlineAlert } from '../../ui'
import { Paperclip, X } from '../../ui/icons'
import { TaskDrawerSection } from './TaskDrawerSection'
import { AttachmentPreview } from './AttachmentPreview'
import { AttachDropZone, AttachFilesButtons } from './WorkItemAttachedFilesSection'
import { MarkUpCopyButton } from '../../components/markup/MarkUpCopyButton'
import { t } from '@shared/i18n'

/**
 * "Attachments" with agents on: the files and Library items attached to this
 * work item, the same list as with agents off. A coding session is also given
 * them, read-only: an embedded one as copies, an external one over the harness
 * API. Only items Ostler AI may read reach an agent; the agent line is quiet
 * and shows once something is attached.
 */
export function WorkItemAttachmentsSection({ workItem }: { workItem: PlanningWorkItem }) {
  const { projectId, id: workItemId } = workItem
  const { attachments, error, attach, detach, isAttached } = useWorkItemAttachments(
    projectId,
    workItemId
  )
  const [library, setLibrary] = useState<LibraryItem[] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)

  const openPicker = async () => {
    if (pickerOpen) {
      setPickerOpen(false)
      return
    }
    const result = await window.ostlerAPI.listLibraryItems(projectId, {})
    if (result.ok) setLibrary(result.value)
    setPickerOpen(true)
  }

  return (
    <TaskDrawerSection
      title={t('tasks:workItemAttachedFiles.title')}
      description={
        attachments.length > 0
          ? t('tasks:workItemAttachmentsSection.libraryItemsAgentGiven', {
              LIBRARY_MAX_TASK_ATTACHMENTS
            })
          : t('tasks:attachFiles.description')
      }
      part={{ id: 'attachments', inUse: attachments.length > 0, start: () => void openPicker() }}
      actions={
        <div className="task-drawer__picker-anchor">
          <AttachFilesButtons workItem={workItem} />
          <Button
            size="sm"
            variant="ghost"
            icon={Paperclip}
            disabled={attachments.length >= LIBRARY_MAX_TASK_ATTACHMENTS && !pickerOpen}
            disabledReason={t('tasks:workItemAttachmentsSection.upToItems', {
              count: LIBRARY_MAX_TASK_ATTACHMENTS
            })}
            onClick={() => void openPicker()}
          >
            {t('tasks:workItemAttachmentsSection.attachLibrary')}
          </Button>
          {pickerOpen && library && (
            // Human-only items too: a person attaches them, and no agent is given one.
            <LibraryAttachPicker
              items={library}
              includeHumanOnly
              selectedIds={attachments.map((attachment) => attachment.item.id)}
              onToggle={(item) =>
                void (isAttached(item.id) ? detach(item.id) : attach(item.id, 'human'))
              }
              onClose={() => setPickerOpen(false)}
              label={t('tasks:workItemAttachmentsSection.attachLibrary')}
            />
          )}
        </div>
      }
    >
      <AttachDropZone workItem={workItem}>
        {attachments.length > 0 ? (
          <ul className="task-library-list">
            {attachments.map((attachment) => {
              const unavailable =
                attachment.item.aiAccess === 'human-only' || Boolean(attachment.item.archivedAt)
              return (
                <li key={attachment.item.id} className="task-library-list__row">
                  {attachment.item.kind === 'image' && attachment.item.file && (
                    <img
                      className="task-library-list__thumb"
                      src={libraryFileUrl(attachment.item, 'thumb')}
                      alt=""
                    />
                  )}
                  <button
                    type="button"
                    className="task-library-list__open"
                    title={t('tasks:attachFiles.previewTitle', { title: attachment.item.title })}
                    onClick={() => setPreviewId(attachment.item.id)}
                  >
                    <span className="task-library-list__kind">
                      {KIND_LABEL[attachment.item.kind]}
                    </span>
                    <span className="task-library-list__title">{attachment.item.title}</span>
                    <span className="task-library-list__meta">
                      {t('tasks:workItemAttachmentsSection.rAttached', {
                        revisionAtAttach: attachment.revisionAtAttach,
                        ATTACHED_BY_LABEL: ATTACHED_BY_LABEL[attachment.attachedBy]
                      })}
                    </span>
                  </button>
                  {attachment.changedSince && (
                    <Badge
                      tone="warning"
                      title={t('tasks:workItemAttachmentsSection.agentGetsCurrentRevision', {
                        currentRevision: attachment.currentRevision
                      })}
                    >
                      {t('tasks:workItemAttachmentsSection.changedSinceRR', {
                        revisionAtAttach: attachment.revisionAtAttach,
                        currentRevision: attachment.currentRevision
                      })}
                    </Badge>
                  )}
                  {unavailable && (
                    <Badge
                      tone="warning"
                      title={t('tasks:workItemAttachmentsSection.humanOnlyArchivedItems')}
                    >
                      {t('tasks:workItemAttachmentsSection.notGivenAgents')}
                    </Badge>
                  )}
                  <MarkUpCopyButton item={attachment.item} workItemId={workItemId} compact />
                  <IconButton
                    size="sm"
                    icon={X}
                    label={t('tasks:workItemAttachedFiles.remove', {
                      title: attachment.item.title
                    })}
                    onClick={() => void detach(attachment.item.id)}
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="task-drawer__muted">{t('tasks:attachFiles.dropHere')}</p>
        )}
      </AttachDropZone>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {previewId && (
        <AttachmentPreview
          projectId={projectId}
          itemId={previewId}
          onClose={() => setPreviewId(null)}
        />
      )}
    </TaskDrawerSection>
  )
}
