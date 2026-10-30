import { useState, type DragEvent, type ReactNode } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { KIND_LABEL, libraryFileUrl } from '../project-detail/library/libraryUi'
import { useWorkItemAttachments } from './useWorkItemAttachments'
import { useAttachFiles } from './useAttachFiles'
import { Button, IconButton } from '../../ui'
import { ClipboardPaste, Paperclip, X } from '../../ui/icons'
import { TaskDrawerSection } from './TaskDrawerSection'
import { MarkUpCopyButton } from '../../components/markup/MarkUpCopyButton'
import { AttachmentPreview } from './AttachmentPreview'
import { t } from '@shared/i18n'

/**
 * Attach files… and Paste picture, for a task's attachments, with agents on
 * or off: what they attach is kept in the project's Library and attached to
 * the task.
 */
export function AttachFilesButtons({ workItem }: { workItem: PlanningWorkItem }) {
  const { pickFiles, pastePicture } = useAttachFiles(workItem.projectId, workItem.id)
  return (
    <>
      <Button size="sm" variant="ghost" icon={Paperclip} onClick={() => void pickFiles()}>
        {t('tasks:attachFiles.attachFiles')}
      </Button>
      <Button size="sm" variant="ghost" icon={ClipboardPaste} onClick={() => void pastePicture()}>
        {t('tasks:attachFiles.pastePicture')}
      </Button>
    </>
  )
}

/** Files dropped on `children` are attached to the task; the area says so while one is over it. */
export function AttachDropZone({
  workItem,
  children
}: {
  workItem: PlanningWorkItem
  children: ReactNode
}) {
  const { attachFiles } = useAttachFiles(workItem.projectId, workItem.id)
  const [over, setOver] = useState(false)
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  return (
    <div
      className={`task-attach-drop${over ? ' is-over' : ''}`}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        setOver(false)
        void attachFiles([...event.dataTransfer.files])
      }}
    >
      {children}
    </div>
  )
}

/**
 * "Attachments" while AI agents are off (N4.2a): the files attached to a
 * task, such as a picture from Snip to task, a pasted picture or a document,
 * with the picture's thumbnail. Attach files…, Paste picture or a drop adds
 * one. It shows once the task has one, the project uses attachments, or it is
 * added from "Add to this task". With agents on, "For the agent"
 * (`WorkItemAttachmentsSection`) lists the same items instead.
 */
export function WorkItemAttachedFilesSection({ workItem }: { workItem: PlanningWorkItem }) {
  const { attachments, detach } = useWorkItemAttachments(workItem.projectId, workItem.id)
  const { pickFiles } = useAttachFiles(workItem.projectId, workItem.id)
  const [previewId, setPreviewId] = useState<string | null>(null)
  return (
    <TaskDrawerSection
      title={t('tasks:workItemAttachedFiles.title')}
      description={t('tasks:attachFiles.description')}
      part={{ id: 'attachments', inUse: attachments.length > 0, start: () => void pickFiles() }}
      actions={<AttachFilesButtons workItem={workItem} />}
    >
      <AttachDropZone workItem={workItem}>
        {attachments.length > 0 ? (
          <ul className="task-library-list">
            {attachments.map(({ item }) => (
              <li key={item.id} className="task-library-list__row">
                {item.kind === 'image' && item.file && (
                  <img
                    className="task-library-list__thumb"
                    src={libraryFileUrl(item, 'thumb')}
                    alt=""
                  />
                )}
                <button
                  type="button"
                  className="task-library-list__open"
                  title={t('tasks:attachFiles.previewTitle', { title: item.title })}
                  onClick={() => setPreviewId(item.id)}
                >
                  <span className="task-library-list__kind">{KIND_LABEL[item.kind]}</span>
                  <span className="task-library-list__title">{item.title}</span>
                </button>
                <MarkUpCopyButton item={item} workItemId={workItem.id} compact />
                <IconButton
                  size="sm"
                  icon={X}
                  label={t('tasks:workItemAttachedFiles.remove', { title: item.title })}
                  onClick={() => void detach(item.id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="task-drawer__muted">{t('tasks:attachFiles.dropHere')}</p>
        )}
      </AttachDropZone>
      {previewId && (
        <AttachmentPreview
          projectId={workItem.projectId}
          itemId={previewId}
          onClose={() => setPreviewId(null)}
        />
      )}
    </TaskDrawerSection>
  )
}
