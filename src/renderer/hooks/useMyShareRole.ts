import { useEffect, useState } from 'react'
import type { ShareRole } from '@shared/ostler-api'

/** The person's role in a shared project, or null for a project that is not shared. Kept fresh. */
export function useMyShareRole(projectId: string | null): ShareRole | null {
  const [role, setRole] = useState<ShareRole | null>(null)
  useEffect(() => {
    if (!projectId) return
    const load = () =>
      void window.ostlerAPI.getShareState(projectId).then((result) => {
        setRole(result.ok && result.value ? result.value.myRole : null)
      })
    load()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'sharing' && update.projectId === projectId) load()
    })
  }, [projectId])
  return role
}
