import type { ProjectViewProps } from '../../navigation/view-props'
import { TimelineView } from '../planning/timeline/TimelineView'

/** The Timeline view. */
export function TimelineTab({ ws, reportView }: ProjectViewProps) {
  return <TimelineView ws={ws} onViewOutput={reportView} />
}
