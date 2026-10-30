import type { RefObject } from 'react'
import type { LinkTargetKind, SearchResult } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { itemLinkUrl } from '@shared/item-links'
import { t } from '@shared/i18n'
import { ITEM_LINK_ICONS, itemKindLabel } from '../ui/Markdown'
import { Icon } from '../ui/icons'
import { useTextTriggerPicker, type TextTriggerPicker } from './useTextTriggerPicker'

const KINDS: readonly LinkTargetKind[] = ['task', 'milestone', 'decision', 'library']
const LIMIT = 8
const SEARCH_DELAY_MS = 120

/** Where `[[` was typed and what follows it up to the caret, or null. */
export function findLinkTrigger(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const start = before.lastIndexOf('[[')
  if (start < 0) return null
  const query = before.slice(start + 2)
  // A trigger ends at a line break or a closing bracket, and is short.
  if (/[\n\]]/.test(query) || query.length > 80) return null
  return { start, query }
}

/** The words of a link: a title with its brackets escaped, so the Markdown stays a link. */
function linkWords(title: string): string {
  return title.replace(/([[\]\\])/g, '\\$1')
}

/** One item a link can point at: a search hit of a kind links take. */
export interface LinkTargetOption {
  kind: LinkTargetKind
  id: string
  projectId: string
  title: string
}

/** How long after typing stops a link-target search runs. */
export const LINK_SEARCH_DELAY_MS = SEARCH_DELAY_MS

/**
 * The project's tasks, milestones, decisions and Library items matching
 * `query`, best first (at most eight): the one search behind every link
 * picker, the `[[` picker and the whiteboard's Link dialog alike. Rejects
 * with the search's error when it fails.
 */
export async function searchLinkTargets(
  projectId: string,
  query: string
): Promise<LinkTargetOption[]> {
  const result = await window.ostlerAPI.search(query, {
    projectId,
    types: [...KINDS],
    limit: LIMIT
  })
  if (!result.ok) throw new Error(result.error)
  return result.value
    .filter((hit): hit is SearchResult & { type: LinkTargetKind } =>
      (KINDS as readonly string[]).includes(hit.type)
    )
    .map((hit) => ({ kind: hit.type, id: hit.id, projectId: hit.projectId, title: hit.title }))
}

export type ItemLinkPicker = TextTriggerPicker

/**
 * Typing `[[` in a text (N4.4a): a picker of the project's tasks,
 * milestones, decisions and Library items, searched as the person types
 * (through search, best first). Enter or a click inserts
 * `[Title](<scheme>://<kind>/<project>/<id>)`; Esc leaves the typed text.
 * One hook for every editor that takes links: a task's description, a
 * comment, a decision's fields and the Library editor.
 */
export function useItemLinkPicker({
  projectId,
  value,
  onChange,
  textRef
}: {
  /** The project whose items are offered; null turns the picker off. */
  projectId: string | null
  value: string
  onChange: (next: string) => void
  /** The textarea the text is typed in. */
  textRef: RefObject<HTMLTextAreaElement | null>
}): ItemLinkPicker {
  return useTextTriggerPicker<LinkTargetOption>({
    value,
    onChange,
    textRef,
    enabled: projectId !== null,
    findTrigger: findLinkTrigger,
    search: (query) =>
      projectId === null ? Promise.resolve([]) : searchLinkTargets(projectId, query),
    searchDelayMs: SEARCH_DELAY_MS,
    openWhenEmpty: true,
    insertText: (option) => `[${linkWords(option.title)}](${itemLinkUrl(option, BRAND.urlScheme)})`,
    optionKey: (option) => `${option.kind}:${option.id}`,
    renderOption: (option) => (
      <>
        <Icon icon={ITEM_LINK_ICONS[option.kind]} />
        <span className="ui-item-link-picker__title">{option.title}</span>
        <span className="ui-item-link-picker__kind">{itemKindLabel(option.kind)}</span>
      </>
    ),
    label: (query) =>
      query === '' ? t('common:itemLinks.pickerHint') : t('common:itemLinks.picker'),
    empty: () => t('common:itemLinks.noMatches')
  })
}
