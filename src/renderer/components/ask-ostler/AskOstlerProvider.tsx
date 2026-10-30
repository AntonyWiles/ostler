import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { AskSource, LibraryItem } from '@shared/ostler-api'
import { Dialog, useToast } from '../../ui'
import { projectPath } from '../../navigation/paths'
import { useFeatures } from '../../navigation/features'
import { AskOstlerPanel, type AskCloseGuard } from './AskOstlerPanel'
import { askSourcePath } from './ask-source-path'
import { t } from '@shared/i18n'

interface AskOstlerApi {
  /** True when Ask Ostler can open: Ostler AI is set up. */
  available: boolean
  /** Opens Ask Ostler with this question typed in. */
  open: (question?: string) => void
}

const AskOstlerContext = createContext<AskOstlerApi>({ available: false, open: () => {} })

export function useAskOstler(): AskOstlerApi {
  return useContext(AskOstlerContext)
}

/**
 * Ask Ostler from anywhere (N8.3a): the command palette's "Ask Ostler…" and the
 * button beside Search's box open this panel. Hidden, and unopenable, while
 * Ostler AI is off.
 */
export function AskOstlerProvider({ children }: { children: ReactNode }) {
  const features = useFeatures()
  const navigate = useNavigate()
  const [state, setState] = useState<{ question: string; key: number } | null>(null)
  const available = features.ai
  const open = useCallback(
    (question?: string) => {
      if (!available) return
      setState((previous) => ({ question: question ?? '', key: (previous?.key ?? 0) + 1 }))
    },
    [available]
  )
  const api = useMemo(() => ({ available, open }), [available, open])
  const { toastUndo } = useToast()
  // The panel's guard: closing a conversation of more than one question asks first.
  const closeGuard = useRef<AskCloseGuard | null>(null)
  const close = (then?: () => void) => {
    const proceed = () => {
      setState(null)
      then?.()
    }
    if (closeGuard.current) closeGuard.current(proceed)
    else proceed()
  }
  const openSource = (source: AskSource) => close(() => navigate(askSourcePath(source)))
  // Saved as a note (N8.3b): the note opens in its Library, with undo.
  const saved = (item: LibraryItem) => {
    setState(null)
    navigate(projectPath(item.projectId, 'library', { item: item.id }))
    toastUndo(t('ai:askOstler.savedNote', { title: item.title }), () =>
      window.ostlerAPI.deleteLibraryItem(item.projectId, item.id)
    )
  }
  return (
    <AskOstlerContext.Provider value={api}>
      {children}
      <Dialog
        open={available && state !== null}
        onClose={() => close()}
        title={t('ai:askOstler.title')}
        description={t('ai:askOstler.description')}
        size="lg"
        closeOnBackdrop={false}
      >
        {state && (
          <AskOstlerPanel
            key={state.key}
            initialQuestion={state.question}
            onOpenSource={openSource}
            onSaved={saved}
            closeGuard={closeGuard}
          />
        )}
      </Dialog>
    </AskOstlerContext.Provider>
  )
}
