import { useEffect, useState } from 'react'
import type { PolicySummary } from '@shared/ostler-api'

/**
 * What the organisation's policy sets on this PC (integrations phase 7), read
 * once: it only changes when Ostler starts. Null until read, and when it
 * can't be.
 */
export function usePolicy(): PolicySummary | null {
  const [policy, setPolicy] = useState<PolicySummary | null>(null)
  useEffect(() => {
    let current = true
    void window.ostlerAPI.getPolicy().then((result) => {
      if (current && result.ok) setPolicy(result.value)
    })
    return () => {
      current = false
    }
  }, [])
  return policy
}
