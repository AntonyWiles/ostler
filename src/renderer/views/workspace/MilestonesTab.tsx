import type { ProjectViewProps } from '../../navigation/view-props'
import { GoalsMilestonesPanel } from '../planning/GoalsMilestonesPanel'

/** Goals as section headers, each with its milestones as cards. */
export function MilestonesTab({ ws }: ProjectViewProps) {
  return <GoalsMilestonesPanel ws={ws} />
}
