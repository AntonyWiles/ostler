import { Avatar } from './Avatar'
import { cx } from './cx'
import './Avatar.css'
import './AvatarGroup.css'
import { t } from '@shared/i18n'

export interface AvatarGroupProps {
  people: Array<{ name: string; color?: string }>
  /** How many avatars to draw before "+N". */
  max?: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** Overlapping avatars; the rest collapse into "+N", whose name lists them. */
export function AvatarGroup({ people, max = 3, size = 'md', className }: AvatarGroupProps) {
  const shown = people.slice(0, max)
  const rest = people.slice(max)
  return (
    <span
      role="group"
      aria-label={t('common:avatarGroup.people', { peopleCount: people.length })}
      className={cx('ui-avatar-group', className)}
    >
      {shown.map((person, index) => (
        <Avatar
          key={`${person.name}-${index}`}
          name={person.name}
          color={person.color}
          size={size}
        />
      ))}
      {rest.length > 0 && (
        <span
          role="img"
          aria-label={t('common:avatarGroup.more', {
            count: rest.length,
            names: rest.map((person) => person.name).join(', ')
          })}
          title={rest.map((person) => person.name).join(', ')}
          className={cx('ui-avatar', `ui-avatar--${size}`, 'ui-avatar--more')}
        >
          <span aria-hidden="true">+{rest.length}</span>
        </span>
      )}
    </span>
  )
}
