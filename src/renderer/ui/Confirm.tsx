import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import './Confirm.css'
import { t } from '@shared/i18n'

export interface ConfirmOptions {
  title: string
  /** The consequence, in plain words. Strings keep their line breaks. */
  body?: ReactNode
  /** Names the action ("Delete decision", "Revoke token"). Never "OK". */
  confirmLabel: string
  cancelLabel?: string
  /** `danger` uses a danger button and starts focus on Cancel. */
  tone?: 'default' | 'danger'
}

export type ConfirmFunction = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFunction | null>(null)

interface Pending extends ConfirmOptions {
  id: number
  resolve: (confirmed: boolean) => void
}

/**
 * Hosts the one confirmation dialog. Mounted once, in App.tsx; anything below
 * it asks with `const confirm = useConfirm()` and `await confirm({...})`.
 * Requests made while one is open wait their turn.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Pending[]>([])
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const nextId = useRef(0)

  const confirm = useCallback<ConfirmFunction>(
    (options) =>
      new Promise<boolean>((resolve) =>
        setQueue((q) => [...q, { ...options, id: nextId.current++, resolve }])
      ),
    []
  )

  const current = queue[0]
  const settle = (confirmed: boolean) => {
    if (!current) return
    current.resolve(confirmed)
    setQueue((q) => q.slice(1))
  }
  const danger = current?.tone === 'danger'

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && (
        <Dialog
          // A fresh dialog per request, so focus handling starts over.
          key={current.id}
          open
          role="alertdialog"
          size="sm"
          title={current.title}
          onClose={() => settle(false)}
          initialFocusRef={danger ? cancelRef : confirmRef}
          footer={
            <>
              <Button ref={cancelRef} variant="secondary" onClick={() => settle(false)}>
                {current.cancelLabel ?? t('common:confirm.cancel')}
              </Button>
              <Button
                ref={confirmRef}
                variant={danger ? 'danger' : 'primary'}
                onClick={() => settle(true)}
              >
                {current.confirmLabel}
              </Button>
            </>
          }
        >
          {current.body !== undefined && <div className="ui-confirm__body">{current.body}</div>}
        </Dialog>
      )}
    </ConfirmContext.Provider>
  )
}

/** `await confirm({ title, body, confirmLabel, tone })` resolves true or false. */
export function useConfirm(): ConfirmFunction {
  const confirm = useContext(ConfirmContext)
  return confirm ?? (() => Promise.reject(new Error(t('common:confirm.useconfirmNeedsAboveApp'))))
}
