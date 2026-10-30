import type { ProjectViewProps } from '../../navigation/view-props'
import { TriageView } from '../planning/triage/TriageView'

/** The project's To triage view (N4.3a), reached from its More menu and the command palette. */
export function TriageTab({ ws }: ProjectViewProps) {
  return <TriageView ws={ws} />
}
