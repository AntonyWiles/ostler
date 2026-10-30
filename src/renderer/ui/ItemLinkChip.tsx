import type { ReactNode } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import type { ItemLinkInfo, ItemLinkRef, LinkTargetKind } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { itemPath } from '../navigation/paths'
import { StatusBadge } from './StatusBadge'
import { VisuallyHidden } from './VisuallyHidden'
import { FileText, Icon, ListChecks, Milestone, Scale, type LucideIcon } from './icons'
import { cx } from './cx'
import './Markdown.css'

/** Each kind of linked item's icon: the same ones search shows. */
export const ITEM_LINK_ICONS: Record<LinkTargetKind, LucideIcon> = {
  task: ListChecks,
  milestone: Milestone,
  decision: Scale,
  library: FileText
}

export function itemKindLabel(kind: LinkTargetKind): string {
  return t(`common:itemLinks.kinds.${kind}`)
}

/**
 * A link to an item (N4.4a): its current title, or "Deleted item"; opens the
 * item. Markdown's links and live lists' tasks (N4.4c) are both drawn with it.
 */
export function ItemLinkChip({
  target,
  info,
  words
}: {
  target: ItemLinkRef
  info: ItemLinkInfo | undefined
  words: ReactNode
}) {
  const routed = useInRouterContext()
  if (info && !info.exists) {
    return (
      <span className="ui-item-link is-deleted">
        <Icon icon={ITEM_LINK_ICONS[target.kind]} />
        <span className="ui-item-link__title">{t('common:itemLinks.deletedItem')}</span>
      </span>
    )
  }
  return routed ? (
    <RoutedItemLink target={target} info={info} words={words} />
  ) : (
    <ItemLinkButton target={target} info={info} words={words} />
  )
}

function RoutedItemLink(props: { target: ItemLinkRef; info?: ItemLinkInfo; words: ReactNode }) {
  const navigate = useNavigate()
  const { target } = props
  return (
    <ItemLinkButton
      {...props}
      onOpen={() => navigate(itemPath(target.kind, target.projectId, target.id))}
    />
  )
}

function ItemLinkButton({
  target,
  info,
  words,
  onOpen
}: {
  target: ItemLinkRef
  info?: ItemLinkInfo
  words: ReactNode
  onOpen?: () => void
}) {
  const title = info?.title ?? null
  return (
    <button
      type="button"
      className={cx('ui-item-link', !title && 'is-loading')}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen?.()
      }}
    >
      {info?.status ? (
        <StatusBadge status={info.status} iconOnly projectId={target.projectId} />
      ) : (
        <Icon icon={ITEM_LINK_ICONS[target.kind]} />
      )}
      <VisuallyHidden>{itemKindLabel(target.kind)}: </VisuallyHidden>
      <span className="ui-item-link__title">{title ?? words}</span>
    </button>
  )
}
