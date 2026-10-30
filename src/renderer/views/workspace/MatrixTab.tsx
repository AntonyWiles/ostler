import type { ProjectViewProps } from '../../navigation/view-props'
import { MatrixView } from '../planning/matrix/MatrixView'

/** The project's priority matrix (N7.5), reached from its More menu. */
export function MatrixTab({ ws }: ProjectViewProps) {
  return <MatrixView ws={ws} />
}
