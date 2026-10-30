import type { ClipboardEvent } from 'react'
import type { ImportLibraryResult, LibraryItem, Result } from '@shared/ostler-api'
import { useToast } from '../../ui'
import { filesToImportInput } from '../project-detail/library/libraryUi'
import { t } from '@shared/i18n'
import { BRAND } from '@shared/brand'
import { itemLinkUrl } from '@shared/item-links'

/** The pictures among pasted or dropped files. */
export function imagesIn(files: Iterable<File>): File[] {
  return [...files].filter((file) => file.type.startsWith('image/'))
}

/** Markdown that shows Library pictures in a text, one per line. */
export function pictureMarkdown(projectId: string, pictures: LibraryItem[]): string {
  return pictures
    .map(
      (picture) =>
        `![${picture.title}](${itemLinkUrl({ kind: 'library', projectId, id: picture.id }, BRAND.urlScheme)})`
    )
    .join('\n')
}

/**
 * Markdown for Library items added to a text, one per line: a picture shows,
 * any other file is a link that opens it (MOP-13, files on a comment).
 */
export function attachmentMarkdown(projectId: string, items: LibraryItem[]): string {
  return items
    .map((item) => {
      const url = itemLinkUrl({ kind: 'library', projectId, id: item.id }, BRAND.urlScheme)
      return item.kind === 'image' ? `![${item.title}](${url})` : `[${item.title}](${url})`
    })
    .join('\n')
}

/**
 * A picture pasted into the description of a task not made yet: kept in the
 * project's Library and handed to `addPictures`, which shows it as a
 * thumbnail under the description (MOP-31). Creating the task attaches it.
 */
export function usePasteDescriptionPictures(
  projectId: string,
  addPictures: (pictures: { id: string; title: string }[]) => void
) {
  const { toast } = useToast()
  return (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = imagesIn(event.clipboardData.files)
    if (images.length === 0 || !projectId) return
    event.preventDefault()
    void filesToImportInput(images)
      .then((input) => window.ostlerAPI.importLibraryFiles(projectId, input))
      .then((imported) => {
        if (!imported.ok) {
          toast({
            title: t('tasks:attachFiles.couldNotAttach'),
            body: imported.error,
            tone: 'danger'
          })
          return
        }
        const items = imported.value === null ? [] : [imported.value].flat().map((r) => r.item)
        if (items.length > 0) addPictures(items.map(({ id, title }) => ({ id, title })))
      })
  }
}

/**
 * Files onto a task: chosen with the file picker, dropped,
 * pasted or taken from the clipboard, each kept in the project's Library and
 * attached to the task, which lists them with the picture's thumbnail. Each
 * call returns the items it attached; a failure is said in a toast.
 */
export function useAttachFiles(projectId: string, workItemId: string) {
  const { toast } = useToast()

  const fail = (error: string) =>
    toast({ title: t('tasks:attachFiles.couldNotAttach'), body: error, tone: 'danger' })

  const attachImported = async (
    imported: Result<ImportLibraryResult[] | ImportLibraryResult | null>
  ): Promise<LibraryItem[]> => {
    if (!imported.ok) {
      fail(imported.error)
      return []
    }
    const results = imported.value === null ? [] : [imported.value].flat()
    const attached: LibraryItem[] = []
    for (const { item } of results) {
      const result = await window.ostlerAPI.attachToWorkItem(
        projectId,
        workItemId,
        item.id,
        'human'
      )
      if (result.ok) attached.push(item)
      else fail(result.error)
    }
    return attached
  }

  /** Files from a drop or a paste: their bytes, never a path. */
  const attachFiles = async (files: File[]) => {
    if (files.length === 0) return []
    const input = await filesToImportInput(files)
    return attachImported(await window.ostlerAPI.importLibraryFiles(projectId, input))
  }

  /** Attach files…: the file picker, in main. */
  const pickFiles = async () => attachImported(await window.ostlerAPI.pickLibraryFiles(projectId))

  /** Paste picture: the picture on the clipboard, or a note that there is none. */
  const pastePicture = async () => {
    const result = await window.ostlerAPI.importLibraryFromClipboard(projectId, { only: 'image' })
    if (result.ok && result.value === null) {
      toast({ title: t('tasks:attachFiles.noPicture') })
      return []
    }
    return attachImported(result)
  }

  return { attachFiles, pickFiles, pastePicture }
}
