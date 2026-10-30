import { useState } from 'react'
import type { LibraryItem } from '@shared/ostler-api'
import { isMarkableImage } from '@shared/markup'
import { Button, IconButton, useToast } from '../../ui'
import { Highlighter } from '../../ui/icons'
import { MarkupEditor } from './MarkupEditor'
import { t } from '@shared/i18n'

/**
 * Mark up a copy (N4.2b): on a picture attached to a task, or a picture in
 * the Library. Opens the editor on the picture and saves a new Library
 * image, "<name> (marked up).png", with the original's AI access, attached
 * to the task (`workItemId`); from the Library it starts unattached. The
 * original is never changed. Shown only for pictures a canvas can open.
 */
export function MarkUpCopyButton({
  item,
  workItemId = null,
  compact = false,
  onSaved
}: {
  item: LibraryItem
  workItemId?: string | null
  /** An icon button, for a row of attachments. */
  compact?: boolean
  onSaved?: (copy: LibraryItem) => void
}) {
  const [open, setOpen] = useState(false)
  const { toast } = useToast()
  if (!isMarkableImage(item)) return null
  const label = t('library:markup.markUpCopyOf', { title: item.title })
  return (
    <>
      {compact ? (
        <IconButton size="sm" icon={Highlighter} label={label} onClick={() => setOpen(true)} />
      ) : (
        <Button
          variant="secondary"
          size="sm"
          icon={Highlighter}
          aria-label={label}
          onClick={() => setOpen(true)}
        >
          {t('library:markup.markUpCopy')}
        </Button>
      )}
      <MarkupEditor
        open={open}
        title={t('library:markup.copyTitle', { name: item.title })}
        saveLabel={t('library:markup.saveCopy')}
        load={async () => {
          const picture = await window.ostlerAPI.getLibraryImage(item.projectId, item.id)
          if (!picture.ok) throw new Error(picture.error)
          return picture.value
        }}
        onSave={async (png) => {
          const saved = await window.ostlerAPI.saveMarkedUpCopy(
            item.projectId,
            item.id,
            workItemId,
            png
          )
          if (!saved.ok) return t('library:markup.couldntSave', { error: saved.error })
          setOpen(false)
          toast({ title: t('library:markup.savedCopy'), body: saved.value.title, tone: 'success' })
          onSaved?.(saved.value)
          return null
        }}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
