import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { SnipPreview } from '@shared/snip'
import { Dialog } from '../../ui'
import { shortcut } from '../../navigation/shortcuts'
import { QuickAddForm } from './QuickAddForm'
import { t } from '@shared/i18n'

interface QuickAddApi {
  /**
   * Opens quick add, with this project chosen when given, and with a snip's
   * picture to attach (N4.2a) when main has just taken one.
   */
  open: (options?: { projectId?: string | null; snip?: SnipPreview }) => void
}

const QuickAddContext = createContext<QuickAddApi>({ open: () => {} })

export function useQuickAdd(): QuickAddApi {
  return useContext(QuickAddContext)
}

interface QuickAddState {
  projectId: string | null
  snip: SnipPreview | null
}

/**
 * Quick add from anywhere (P5.6): Ctrl+Shift+N, or Ctrl+N in a project with
 * that project chosen. Inside the app only; a system-wide hotkey is P8.2.
 * With a snip (N4.2a), closing it without Add drops the picture in main, so
 * nothing is kept.
 */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<QuickAddState | null>(null)
  const open = useCallback(
    (options?: { projectId?: string | null; snip?: SnipPreview }) =>
      setState((current) => {
        // Whatever replaces a snip still waiting lets it go (dropping it twice is harmless).
        if (current?.snip && current.snip.snipId !== options?.snip?.snipId)
          void window.ostlerAPI.discardSnip(current.snip.snipId)
        return { projectId: options?.projectId ?? null, snip: options?.snip ?? null }
      }),
    []
  )
  const close = useCallback(() => {
    setState((current) => {
      if (current?.snip) void window.ostlerAPI.discardSnip(current.snip.snipId)
      return null
    })
  }, [])
  const api = useMemo(() => ({ open }), [open])
  const snip = state?.snip ?? null
  return (
    <QuickAddContext.Provider value={api}>
      {children}
      <Dialog
        open={state !== null}
        onClose={close}
        title={snip ? t('tasks:quickAddProvider.snipTitle') : t('tasks:quickAddProvider.quickAdd')}
        description={
          snip
            ? t('tasks:quickAddProvider.snipDescription')
            : t('tasks:quickAddProvider.typeTaskLabelPerson', {
                keys: shortcut('quick-add').keys
              })
        }
        size="lg"
      >
        {state && (
          <QuickAddForm
            key={snip?.snipId ?? 'quick-add'}
            variant="dialog"
            autoFocus
            defaultProjectId={state.projectId}
            snip={snip}
            onCancel={snip ? close : undefined}
            onCreated={() => setState(null)}
          />
        )}
      </Dialog>
    </QuickAddContext.Provider>
  )
}
