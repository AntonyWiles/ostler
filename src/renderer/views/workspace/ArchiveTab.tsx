import type { ProjectViewProps } from '../../navigation/view-props'
import { ArchiveView } from '../planning/ArchiveView'

/** Archived tasks, reached from the project's More menu. */
export function ArchiveTab({ ws }: ProjectViewProps) {
  return <ArchiveView ws={ws} mode="archive" />
}

/** Deleted tasks, reached from the project's More menu. */
export function RecycleBinTab({ ws }: ProjectViewProps) {
  return <ArchiveView ws={ws} mode="bin" />
}
