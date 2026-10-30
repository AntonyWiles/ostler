import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { ChangeHistoryHead, ChangeUndoResult, Result } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { isEditable, useToast } from '../ui'
import { useAppCommands } from '../shell/app-commands'
import { undoHistoryPath } from '../navigation/paths'
import { describeStep } from './describe-change'
import { dialogOpen } from '../utils/dom'

export interface ChangeHistoryApi {
  /** The steps Undo and Redo would act on now, for their tooltips and enabled state. */
  head: ChangeHistoryHead
  /** Undoes the newest step still in force. */
  undo: () => Promise<void>
  /** Puts back the newest undone step. */
  redo: () => Promise<void>
  /** Undoes one step, whenever it was. */
  undoEntry: (entryId: string) => Promise<void>
  /** Puts one undone step back. */
  redoEntry: (entryId: string) => Promise<void>
  openHistory: () => void
}

const EMPTY_HEAD: ChangeHistoryHead = { undo: null, redo: null }

const ChangeHistoryContext = createContext<ChangeHistoryApi | null>(null)

/**
 * The undo history's Undo and Redo for the whole window: the title bar's
 * buttons, the Edit menu, and the keys. Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z)
 * outside a text field reach the history only when nothing nearer took them:
 * a toast's own Undo and a task drawer's last save come first.
 */
export function ChangeHistoryProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [head, setHead] = useState<ChangeHistoryHead>(EMPTY_HEAD)

  const loadHead = useCallback(async () => {
    const result = await window.ostlerAPI.getChangeHistoryHead?.()
    if (result?.ok) setHead(result.value)
  }, [])

  useEffect(() => {
    void loadHead()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'history') void loadHead()
    })
  }, [loadHead])

  /**
   * Runs an undo or redo and says what it did. The toast's button undoes that
   * undo again: Redo after an undo, Undo after a redo.
   */
  const run = useCallback(
    async function run(
      call: Promise<Result<ChangeUndoResult>>,
      direction: 'undo' | 'redo'
    ): Promise<void> {
      const result = await call
      if (!result.ok) {
        toast({
          title:
            direction === 'undo'
              ? t('views:undoHistory.toast.couldNotUndo')
              : t('views:undoHistory.toast.couldNotRedo'),
          body: result.error,
          tone: 'danger'
        })
        return
      }
      const { entry, kept } = result.value
      if (!entry) {
        toast({ title: t('views:undoHistory.toast.nothingLeft'), tone: 'info' })
        return
      }
      const step = describeStep(entry)
      const back = direction === 'undo' ? 'redo' : 'undo'
      toast({
        title:
          direction === 'undo'
            ? t('views:undoHistory.toast.undone', { step })
            : t('views:undoHistory.toast.redone', { step }),
        body: kept > 0 ? t('views:undoHistory.toast.kept', { count: kept }) : undefined,
        tone: kept > 0 ? 'warning' : 'success',
        action: {
          label:
            back === 'undo' ? t('views:undoHistory.toast.undo') : t('views:undoHistory.toast.redo'),
          onClick: () => void run(window.ostlerAPI.undoChange(entry.id), back)
        }
      })
    },
    [toast]
  )

  const api = useMemo<ChangeHistoryApi>(
    () => ({
      head,
      undo: () => run(window.ostlerAPI.undoLatestChange(), 'undo'),
      redo: () => run(window.ostlerAPI.redoLatestChange(), 'redo'),
      undoEntry: (entryId) => run(window.ostlerAPI.undoChange(entryId), 'undo'),
      redoEntry: (entryId) => run(window.ostlerAPI.redoChange(entryId), 'redo'),
      openHistory: () => navigate(undoHistoryPath())
    }),
    [head, run, navigate]
  )

  // Keys: only when focus is not in a text field, and only when no toast or
  // drawer took the key first (they run in the same dispatch; this looks after).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat) return
      const key = event.key.toLowerCase()
      const direction =
        key === 'z' && !event.shiftKey
          ? 'undo'
          : key === 'y' || (key === 'z' && event.shiftKey)
            ? 'redo'
            : null
      if (!direction || isEditable(event.target)) return
      if (dialogOpen()) return
      setTimeout(() => {
        if (event.defaultPrevented) return
        void (direction === 'undo' ? api.undo() : api.redo())
      }, 0)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [api])

  // The Edit menu: in a text field, its own typing; elsewhere, the history.
  useAppCommands({
    undo: () => {
      if (isEditable(document.activeElement)) document.execCommand('undo')
      else void api.undo()
    },
    redo: () => {
      if (isEditable(document.activeElement)) document.execCommand('redo')
      else void api.redo()
    },
    'undo-history': () => api.openHistory()
  })

  return <ChangeHistoryContext.Provider value={api}>{children}</ChangeHistoryContext.Provider>
}

const NO_HISTORY: ChangeHistoryApi = {
  head: EMPTY_HEAD,
  undo: async () => {},
  redo: async () => {},
  undoEntry: async () => {},
  redoEntry: async () => {},
  openHistory: () => {}
}

/** The window's Undo and Redo; outside the provider (tests), a version that does nothing. */
export function useChangeHistory(): ChangeHistoryApi {
  return useContext(ChangeHistoryContext) ?? NO_HISTORY
}
