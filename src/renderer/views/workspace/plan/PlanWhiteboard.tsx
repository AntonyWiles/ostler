import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  ImportLibraryResult,
  LibraryItem,
  PlanningMilestone,
  Result
} from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { PERF_MARKS } from '@shared/perf-marks'
import { t } from '@shared/i18n'
import { itemLinkTarget } from '@shared/item-links'
import { useRenderedMark } from '../../../lib/perf-marks'
import { itemPath } from '../../../navigation/paths'
import { focusWithoutScroll } from '../../../shell/route-focus'
import { WhiteboardEditor } from '../../../components/whiteboard/WhiteboardEditor'
import type {
  PictureRef,
  WhiteboardPictureSource
} from '../../../components/whiteboard/picture-source'
import { useWhiteboardDocument } from '../../../components/whiteboard/useWhiteboardDocument'
import { useReportSaveStatus } from '../../../shell/save-status'
import { exportViewBox, whiteboardPng, whiteboardSvg } from '../../../components/whiteboard/export'
import {
  Button,
  Dialog,
  EmptyState,
  ErrorText,
  InlineAlert,
  Menu,
  Spinner,
  TextField,
  useAnnounce,
  useToast
} from '../../../ui'
import { ArrowLeft, Download, Pencil, Presentation } from '../../../ui/icons'
import {
  filesToImportInput,
  libraryFileUrl,
  libraryItemFileUrl
} from '../../project-detail/library/libraryUi'

export interface PlanWhiteboardProps {
  projectId: string
  whiteboardId: string
  /** The project's milestones: Make tasks offers the planned and active ones (prompt 13). */
  milestones?: readonly PlanningMilestone[]
  /** Closes the board; its changes are already being saved. */
  onBack(): void
}

/** What Export makes (prompt 16, D15), and Print and Save as PDF (prompt 17). */
type ExportKind = 'png' | 'svg' | 'file'
type PrintOutput = 'printer' | 'pdf'

/** The name of a saved file, for its toast. */
function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

/** The error's own words, for the page's alert. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A Library picture as the editor takes it. */
function pictureRef(item: LibraryItem): PictureRef {
  return {
    itemId: item.id,
    title: item.title,
    width: item.file?.width,
    height: item.file?.height,
    thumbnailUrl: libraryFileUrl(item, 'thumb')
  }
}

/**
 * The editor's pictures from the project's Library (prompt 11, D11): imports
 * go through the Library's own IPC, so each picture is a Library image item
 * (or the one the project already holds). A failure is reported through
 * `onError` and answered with no pictures; items that are not pictures are
 * left out.
 */
function libraryPictures(
  projectId: string,
  onError: (error: string | null) => void
): WhiteboardPictureSource {
  const pictures = (items: LibraryItem[]) =>
    items.filter((item) => item.kind === 'image').map(pictureRef)
  const imported = (result: Result<ImportLibraryResult[]>): PictureRef[] => {
    if (!result.ok) {
      onError(result.error)
      return []
    }
    onError(null)
    return pictures(result.value.map((entry) => entry.item))
  }
  const guarded =
    <T extends unknown[]>(run: (...args: T) => Promise<PictureRef[]>) =>
    async (...args: T): Promise<PictureRef[]> => {
      try {
        return await run(...args)
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error))
        return []
      }
    }
  return {
    importFiles: guarded(async (files: File[]) =>
      imported(
        await window.ostlerAPI.importLibraryFiles(projectId, await filesToImportInput(files))
      )
    ),
    pickFiles: guarded(async () =>
      imported(await window.ostlerAPI.pickLibraryFiles(projectId, { only: 'image' }))
    ),
    listLibraryPictures: guarded(async () => {
      const result = await window.ostlerAPI.listLibraryItems(projectId, { kind: 'image' })
      if (!result.ok) {
        onError(result.error)
        return []
      }
      return pictures(result.value)
    })
  }
}

/**
 * One whiteboard open on the Plan, filling the page (plan `docs/plans/whiteboards/`, D4):
 * Back to the plan, the title, Rename, the save state and the editor. Loaded with
 * `React.lazy` (D28), so the editor is not part of the Plan's first load.
 */
export function PlanWhiteboard({
  projectId,
  whiteboardId,
  milestones,
  onBack
}: PlanWhiteboardProps) {
  const doc = useWhiteboardDocument(projectId, whiteboardId)
  // Saved, saving or not: the status bar says it (MOP-29).
  useReportSaveStatus(doc.readOnly ? null : doc.saveState)
  const navigate = useNavigate()
  const announce = useAnnounce()
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [pictureError, setPictureError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)
  const { toast } = useToast()
  const { flush } = doc
  const pictures = useMemo(() => libraryPictures(projectId, setPictureError), [projectId])

  const back = useCallback(() => {
    void flush()
    onBack()
  }, [flush, onBack])

  /**
   * Opens an object's link (prompt 12): saves first, then an item that still
   * exists opens where it lives (a task in its drawer, over this board), a
   * deleted item is announced, and a web address opens in the browser.
   */
  const { links } = doc
  const openLink = useCallback(
    async (url: string) => {
      await flush()
      const target = itemLinkTarget(url, BRAND.urlScheme)
      if (!target) {
        void window.ostlerAPI.openExternalLink(url)
        return
      }
      const info = links.get(url)
      if (info && !info.exists) {
        announce(t('common:itemLinks.deletedItem'))
        return
      }
      navigate(itemPath(target.kind, target.projectId, target.id))
    },
    [flush, links, announce, navigate]
  )
  const onOpenLink = useCallback((url: string) => void openLink(url), [openLink])

  /**
   * Export (prompt 16, D15): the editor's changes are saved first; a PNG or
   * SVG is drawn here and main saves its bytes, a whiteboard file is made by
   * main from the stored board. A cancelled dialog says nothing.
   */
  const { objects } = doc
  const exportBoard = useCallback(
    async (kind: ExportKind) => {
      setExporting(true)
      setExportError(null)
      setPrintError(null)
      try {
        await flush()
        let saved: string | null
        let missingPictures = 0
        if (kind === 'file') {
          const result = await window.ostlerAPI.exportWhiteboardFile(projectId, whiteboardId)
          if (!result.ok) throw new Error(result.error)
          saved = result.value.path
          missingPictures = result.value.missingPictures
        } else {
          const svg = await whiteboardSvg(objects, { projectId, links })
          const box = exportViewBox(objects)
          const bytes =
            kind === 'svg'
              ? new TextEncoder().encode(svg)
              : await whiteboardPng(svg, box.width, box.height)
          const result = await window.ostlerAPI.saveWhiteboardImage(projectId, {
            whiteboardId,
            kind,
            bytes
          })
          if (!result.ok) throw new Error(result.error)
          saved = result.value
        }
        if (saved === null) return
        toast({
          title: t('library:whiteboard.export.saved', { name: fileNameOf(saved) }),
          body:
            missingPictures > 0
              ? t('library:whiteboard.export.missingPictures', { count: missingPictures })
              : undefined,
          tone: 'success'
        })
      } catch (error) {
        setExportError(messageOf(error))
      } finally {
        setExporting(false)
      }
    },
    [flush, objects, projectId, links, whiteboardId, toast]
  )

  /**
   * Print… and Save as PDF… (prompt 17, D15): the changes are saved first, then main draws the
   * stored board in its print window. A saved PDF is a toast; a cancelled dialog says nothing.
   */
  const printBoard = useCallback(
    async (output: PrintOutput) => {
      setExporting(true)
      setExportError(null)
      setPrintError(null)
      try {
        await flush()
        const result = await window.ostlerAPI.printWhiteboard({ projectId, whiteboardId, output })
        if (!result.ok) throw new Error(result.error)
        if (output === 'pdf' && result.value !== null) {
          toast({
            title: t('library:whiteboard.print.saved', { name: fileNameOf(result.value) }),
            tone: 'success'
          })
        }
      } catch (error) {
        setPrintError(messageOf(error))
      } finally {
        setExporting(false)
      }
    },
    [flush, projectId, whiteboardId, toast]
  )
  const imageUrl = useCallback(
    (imageItemId: string) => libraryItemFileUrl(projectId, imageItemId, 'file'),
    [projectId]
  )

  /** The editor is on screen with the board's objects. */
  const shown = doc.status === 'ready' && doc.item !== null
  // The perf suite's whiteboard open (docs/performance.md): the objects are drawn and painted.
  useRenderedMark(PERF_MARKS.whiteboardRendered, shown, whiteboardId, {
    objects: doc.objects.length
  })
  /**
   * The board has opened: when focus was lost on the way (the dialog or button
   * that opened it is gone), it goes to the board's title, as a new page's does.
   */
  useEffect(() => {
    if (!shown) return
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return
    if (headingRef.current) focusWithoutScroll(headingRef.current)
  }, [shown])

  const backButton = (
    <Button variant="ghost" icon={ArrowLeft} onClick={back}>
      {t('views:planView.whiteboards.back')}
    </Button>
  )

  if (doc.status === 'loading') {
    return (
      <div className="plan-board plan-board--message">
        <Spinner label={t('views:planView.whiteboards.opening')} />
      </div>
    )
  }
  if (doc.status === 'missing') {
    return (
      <div className="plan-board plan-board--message">
        <EmptyState
          icon={Presentation}
          title={t('views:planView.whiteboards.missingTitle')}
          description={t('views:planView.whiteboards.missingDescription')}
          action={backButton}
        />
      </div>
    )
  }
  if (doc.status === 'error' || doc.item === null) {
    return (
      <div className="plan-board plan-board--message">
        <EmptyState
          icon={Presentation}
          title={t('views:planView.whiteboards.loadFailed')}
          description={doc.error ? <ErrorText>{doc.error}</ErrorText> : undefined}
          action={backButton}
        />
      </div>
    )
  }

  const item = doc.item
  return (
    <section className="plan-board" aria-labelledby={headingId}>
      <div className="plan-board__head">
        {backButton}
        <h2 id={headingId} ref={headingRef} className="plan-board__title">
          {item.title}
        </h2>
        {!doc.readOnly && (
          <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setRenaming(true)}>
            {t('views:planView.whiteboards.rename')}
          </Button>
        )}
        <Menu
          label={t('library:whiteboard.export.menu')}
          placement="bottom-end"
          items={[
            {
              label: t('library:whiteboard.export.png'),
              disabled: exporting,
              onSelect: () => void exportBoard('png')
            },
            {
              label: t('library:whiteboard.export.svg'),
              disabled: exporting,
              onSelect: () => void exportBoard('svg')
            },
            {
              label: t('library:whiteboard.export.file'),
              disabled: exporting,
              onSelect: () => void exportBoard('file')
            },
            { type: 'separator' },
            {
              label: t('library:whiteboard.export.print'),
              disabled: exporting,
              onSelect: () => void printBoard('printer')
            },
            {
              label: t('library:whiteboard.export.pdf'),
              disabled: exporting,
              onSelect: () => void printBoard('pdf')
            }
          ]}
          renderTrigger={(trigger) => (
            <Button {...trigger} variant="ghost" size="sm" icon={Download} loading={exporting}>
              {t('library:whiteboard.export.menu')}
            </Button>
          )}
        />
      </div>
      {doc.saveState === 'failed' && doc.error && (
        <InlineAlert tone="danger">{doc.error}</InlineAlert>
      )}
      {exportError && (
        <InlineAlert tone="danger" onDismiss={() => setExportError(null)}>
          {t('library:whiteboard.export.failed', { error: exportError })}
        </InlineAlert>
      )}
      {printError && (
        <InlineAlert tone="danger" onDismiss={() => setPrintError(null)}>
          {t('library:whiteboard.print.failed', { error: printError })}
        </InlineAlert>
      )}
      {pictureError && (
        <InlineAlert tone="danger" onDismiss={() => setPictureError(null)}>
          {t('library:whiteboard.picture.failed', { error: pictureError })}
        </InlineAlert>
      )}
      <div className="plan-board__editor">
        <WhiteboardEditor
          title={item.title}
          objects={doc.objects}
          version={doc.version}
          onChange={doc.onChange}
          readOnly={doc.readOnly}
          imageUrl={imageUrl}
          links={doc.links}
          projectId={projectId}
          pictures={pictures}
          pictureTitles={doc.pictureTitles}
          onOpenLink={onOpenLink}
          whiteboardId={whiteboardId}
          milestones={milestones}
          flush={flush}
        />
      </div>
      {renaming && (
        <RenameDialog projectId={projectId} item={item} onClose={() => setRenaming(false)} />
      )}
    </section>
  )
}

export default PlanWhiteboard

function RenameDialog({
  projectId,
  item,
  onClose
}: {
  projectId: string
  item: LibraryItem
  onClose(): void
}) {
  const [title, setTitle] = useState(item.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const next = title.trim()
    if (!next) return
    if (next === item.title) {
      onClose()
      return
    }
    setBusy(true)
    const result = await window.ostlerAPI.updateLibraryItem(projectId, item.id, { title: next })
    setBusy(false)
    if (result.ok) onClose()
    else setError(result.error)
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('views:planView.whiteboards.renameTitle')}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('views:planView.whiteboards.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!title.trim()}
            onClick={() => void submit()}
          >
            {t('views:planView.whiteboards.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('views:planView.whiteboards.titleLabel')}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            setError(null)
          }}
          data-autofocus
        />
      </form>
    </Dialog>
  )
}
