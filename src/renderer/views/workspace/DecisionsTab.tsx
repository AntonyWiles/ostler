import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ProjectViewProps } from '../../navigation/view-props'
import { DecisionsPanel } from '../planning/DecisionsPanel'

/**
 * The project's decision log. `?decision=<id>` (a search result, P5.7) opens
 * that decision once the log has loaded.
 */
export function DecisionsTab({ ws }: ProjectViewProps) {
  const [params, setParams] = useSearchParams()
  const requested = params.get('decision')
  useEffect(() => {
    if (!requested) return
    const decision = ws.decisions.find((candidate) => candidate.id === requested)
    // Wait for the first load: until then an unknown id may just not be here yet.
    if (!decision && !ws.loaded) return
    if (decision) ws.openDecisionEdit(decision)
    const next = new URLSearchParams(params)
    next.delete('decision')
    setParams(next, { replace: true })
    // Runs when the requested decision can be found.
  }, [requested, ws.decisions, ws.loaded])
  return <DecisionsPanel ws={ws} />
}
