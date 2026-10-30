import { t } from '@shared/i18n'
import { usePeople } from '../context/PeopleContext'
import { Avatar } from './Avatar'
import './Markdown.css'

/**
 * A mention in a comment (prompt 14): the person's initials and current name,
 * drawn from the id in the link, never from the link's words. A person who
 * is not in the address book any more reads "Someone no longer here".
 */
export function MentionChip({ personId }: { personId: string }) {
  const person = usePeople().byId.get(personId)
  if (!person) {
    return (
      <span className="ui-item-link ui-mention is-deleted">
        <span className="ui-item-link__title">{t('common:mentions.noLongerHere')}</span>
      </span>
    )
  }
  return (
    <span className="ui-item-link ui-mention">
      <Avatar name={person.name} color={person.color} initials={person.initials} size="sm" />
      <span className="ui-item-link__title">@{person.name}</span>
    </span>
  )
}
