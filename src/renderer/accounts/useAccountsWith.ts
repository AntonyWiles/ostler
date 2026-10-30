import { useEffect, useState } from 'react'
import type { AccountCapability, ConnectedAccount } from '@shared/ostler-api'

/**
 * The connected accounts that give `capability`, kept current as accounts
 * are connected and removed. Buttons such as Add from an account… show only
 * when there is one.
 */
export function useAccountsWith(capability: AccountCapability): ConnectedAccount[] {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  useEffect(() => {
    let current = true
    const load = () =>
      void window.ostlerAPI.listAccounts().then((result) => {
        if (current && result.ok) {
          setAccounts(result.value.filter((account) => account.capabilities.includes(capability)))
        }
      })
    load()
    const off = window.ostlerAPI.onAccountsChange(load)
    return () => {
      current = false
      off()
    }
  }, [capability])
  return accounts
}

/** "Google · ann@example.com". */
export function accountName(
  account: Pick<ConnectedAccount, 'provider' | 'label'>,
  t: (key: string) => string
): string {
  return `${t(`settings:accounts.provider.${account.provider}`)} · ${account.label}`
}
