import { isProjectIcon } from '@shared/project-icons'
import { Icon } from '../ui/icons'
import { cx } from '../ui/cx'
import { PROJECT_ICON_GLYPHS } from './project-icon-glyphs'
import './ProjectMark.css'

/**
 * A project's colour, and its icon when it has one (N5.1): the icon drawn in
 * the project's colour, else the colour dot. Decorative: the project's name
 * beside it is what is announced.
 */
export function ProjectMark({
  project,
  className
}: {
  project: { color?: string; icon?: string | null } | null | undefined
  className?: string
}) {
  const color = project?.color || 'var(--color-text-muted)'
  if (project && isProjectIcon(project.icon)) {
    return (
      <span className="project-mark project-mark--icon" style={{ color }}>
        <Icon icon={PROJECT_ICON_GLYPHS[project.icon]} />
      </span>
    )
  }
  return (
    <span
      className={cx('project-mark', 'project-mark--dot', className)}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  )
}
