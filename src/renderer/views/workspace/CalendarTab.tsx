import type { ProjectViewProps } from '../../navigation/view-props'
import { CalendarView } from '../planning/calendar/CalendarView'

/** The Calendar view. */
export function CalendarTab({ ws }: ProjectViewProps) {
  return <CalendarView ws={ws} />
}
