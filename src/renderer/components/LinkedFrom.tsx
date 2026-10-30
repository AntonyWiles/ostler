import { useEffect, useId, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import type { LinkedFromEntry, LinkTargetKind } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { itemPath, taskPath } from '../navigation/paths'
import { FileText, Icon, ListChecks, MessageSquare, Scale, type LucideIcon } from '../ui/icons'
import './LinkedFrom.css'

const SOURCE_ICONS: Record<LinkedFromEntry['sourceKind'], LucideIcon> = {
  task: ListChecks,
  comment: MessageSquare,
  decision: Scale,
  library: FileText
}

/** Where a source opens: a task or comment in the task's drawer, a decision or Library item in place. */
export function linkedFromPath(entry: LinkedFromEntry): string {
  switch (entry.sourceKind) {
    case 'task':
    case 'comment':
      return taskPath(entry.projectId, entry.workItemId ?? entry.sourceId)
    case 'decision':
    case 'library':
      return itemPath(entry.sourceKind, entry.projectId, entry.sourceId)
  }
}

/** "Comment on “Fix the header”", "Decision: Use the new supplier". */
export function linkedFromLabel(entry: LinkedFromEntry): string {
  return t(`common:itemLinks.sources.${entry.sourceKind}`, { title: entry.title })
}

/**
 * Linked from (N4.4a): the texts that link to this item, each opening its
 * source. Read once when shown, and again when `refreshKey` changes. Shows
 * nothing while nothing links here, so items without links stay as they were.
 */
export function LinkedFrom(props: LinkedFromProps) {
  // Outside a router (a component shown on its own) there is nowhere to open a source.
  return useInRouterContext() ? <LinkedFromList {...props} /> : null
}

interface LinkedFromProps {
  className?: string
  kind: LinkTargetKind
  id: string
  refreshKey?: unknown
  /** Called before a source opens: a dialog closes itself, for instance. */
  onOpen?: () => void
  headingLevel?: 2 | 3 | 4
}

function LinkedFromList({
  kind,
  id,
  refreshKey,
  onOpen,
  headingLevel = 3,
  className
}: LinkedFromProps) {
  const navigate = useNavigate()
  const headingId = useId()
  const [entries, setEntries] = useState<LinkedFromEntry[]>([])

  useEffect(() => {
    let live = true
    void window.ostlerAPI.getLinkedFrom(kind, id).then((result) => {
      if (!live) return
      // A list that cannot be read shows nothing rather than an error under every item.
      setEntries(result.ok ? result.value : [])
    })
    return () => {
      live = false
    }
  }, [kind, id, refreshKey])

  if (entries.length === 0) return null
  const Heading = `h${headingLevel}` as const
  return (
    <section
      className={['linked-from', className].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <Heading id={headingId} className="linked-from__title">
        {t('common:itemLinks.linkedFrom')}
      </Heading>
      <ul className="linked-from__list">
        {entries.map((entry) => (
          <li key={`${entry.sourceKind}:${entry.sourceId}`}>
            <button
              type="button"
              className="linked-from__entry"
              onClick={() => {
                onOpen?.()
                navigate(linkedFromPath(entry))
              }}
            >
              <Icon icon={SOURCE_ICONS[entry.sourceKind]} />
              <span>{linkedFromLabel(entry)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
