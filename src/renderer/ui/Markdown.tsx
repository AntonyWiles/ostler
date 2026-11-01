import { useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { ItemLinkInfo, ItemLinkRef } from '@shared/ostler-api'
import { autolinkBareUrls } from '@shared/autolink'
import { fileLinkTarget, relativeFileHref, type FileLinkTarget } from '@shared/file-links'
import { t } from '@shared/i18n'
import { findTaskKeys, linkTaskKeys } from '@shared/task-key-links'
import { BRAND } from '@shared/brand'
import { LEGACY_NAMES } from '@shared/legacy-names'
import { extractItemLinks, itemLinkTarget } from '@shared/item-links'
import { mentionPersonId } from '@shared/mentions'
import { findLiveListBlocks, LIVE_LIST_INFO } from '@shared/live-list'
import { ItemLinkChip } from './ItemLinkChip'
import { MentionChip } from './MentionChip'
import { LiveList, liveListKey, useLiveLists } from './LiveList'
import { useToast } from './Toast'
import './Markdown.css'

export { ITEM_LINK_ICONS, itemKindLabel } from './ItemLinkChip'

/** Hast as far as finding a fenced block's code needs it. */
interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

/** The text of a `pre` that holds an `ostler-tasks` block, or null for any other. */
function liveListText(node: HastNode | undefined): string | null {
  const code = node?.children?.find((child) => child.type === 'element')
  if (!code || code.tagName !== 'code') return null
  const classes = code.properties?.className
  if (!Array.isArray(classes) || !classes.includes(`language-${LIVE_LIST_INFO}`)) return null
  return (code.children ?? []).map((child) => child.value ?? '').join('')
}

/**
 * The sanitiser's schema (N4.4a): the default, which strips scripts, event
 * handlers and every scheme but the web's, plus Ostler's own scheme for
 * `href`, and for `src`, a picture kept in the Library. The URL transform
 * below lets that scheme through only in the item-link shapes, so the two
 * together allow exactly those links.
 */
const SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), BRAND.urlScheme, LEGACY_NAMES.urlScheme],
    src: [...(defaultSchema.protocols?.src ?? []), BRAND.urlScheme, LEGACY_NAMES.urlScheme]
  }
}

/**
 * Where a picture's bytes come from: a Library item's link (a pasted
 * picture, `![…](ostler://library/…)`) reads the item's file; any other of
 * ours shows nothing.
 */
export function markdownImageSrc(src: string | undefined): string | undefined {
  if (!src) return src
  if (!OWN_SCHEMES.some((own) => src.slice(0, own.length).toLowerCase() === own)) return src
  const ref = itemLinkTarget(src, BRAND.urlScheme)
  if (ref?.kind !== 'library') return undefined
  return `ostler-library://${encodeURIComponent(ref.projectId)}/${encodeURIComponent(ref.id)}/file`
}

/** Ours, and the scheme texts written before the rename use (legacy-names.ts). */
const OWN_SCHEMES = [`${BRAND.urlScheme}:`, `${LEGACY_NAMES.urlScheme}:`]

/** react-markdown's own transform, except that an item link, a file link or a mention survives it; any other link of ours does not. */
export function markdownUrlTransform(url: string): string {
  if (OWN_SCHEMES.some((own) => url.slice(0, own.length).toLowerCase() === own)) {
    return itemLinkTarget(url, BRAND.urlScheme) ||
      mentionPersonId(url, BRAND.urlScheme) ||
      fileLinkTarget(url, BRAND.urlScheme)
      ? url
      : ''
  }
  return defaultUrlTransform(url)
}

/**
 * The file a link in a project's text points at: an `ostler://file/…` link,
 * or a path written relative to the project (`docs/plan.md`).
 */
export function markdownFileTarget(
  href: string | undefined,
  projectId: string | null | undefined
): FileLinkTarget | null {
  if (!href) return null
  const linked = fileLinkTarget(href, BRAND.urlScheme)
  if (linked) return linked
  const path = projectId ? relativeFileHref(href) : null
  return path && projectId ? { projectId, path } : null
}

/**
 * Links to the tasks a text names by ID (BRI-26), by ID in capitals: one
 * call per text, again only when the IDs or `refreshKey` change.
 */
function useTaskKeyUrls(
  projectId: string | null | undefined,
  keys: string[],
  refreshKey: unknown
): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map())
  const key = keys.join(',')
  useEffect(() => {
    if (!projectId || keys.length === 0) return
    let live = true
    void window.ostlerAPI.resolveTaskKeys(projectId, keys).then((result) => {
      if (!live || !result.ok) return
      setUrls(
        new Map(
          result.value.map((entry) => [
            entry.key.toUpperCase(),
            `${BRAND.urlScheme}://task/${projectId}/${entry.id}`
          ])
        )
      )
    })
    return () => {
      live = false
    }
    // `key` stands for `keys`, which is a new array each render.
  }, [projectId, key, refreshKey])
  return urls
}

const refKey = (ref: { kind: string; id: string }) => `${ref.kind}:${ref.id}`

/**
 * The current titles of the items a text links to: one call per text, again
 * only when its links or `refreshKey` change. Texts with no links call nothing.
 */
function useItemLinkInfo(refs: ItemLinkRef[], refreshKey: unknown): Map<string, ItemLinkInfo> {
  const [info, setInfo] = useState<Map<string, ItemLinkInfo>>(() => new Map())
  const key = refs.map(refKey).join(',')
  useEffect(() => {
    if (refs.length === 0) return
    let live = true
    void window.ostlerAPI.resolveItemLinks(refs).then((result) => {
      if (!live || !result.ok) return
      setInfo(new Map(result.value.map((entry) => [refKey(entry), entry])))
    })
    return () => {
      live = false
    }
    // `key` stands for `refs`, which is a new array each render.
  }, [key, refreshKey])
  return info
}

export interface MarkdownProps {
  /** The Markdown text. */
  children: string
  /** Read linked items' titles again when this changes (a view's records, for instance). */
  refreshKey?: unknown
  /** A class for a wrapping `div`; without one the Markdown has no wrapper. */
  className?: string
  /**
   * The project the text belongs to: its `ostler-tasks` blocks (N4.4c) show
   * as live lists of that project's tasks. Without one they show as a note.
   */
  projectId?: string | null
  /**
   * A control after a list item's words (N4.4b's Make a task), given the
   * item's first line in the text, counted from 0; null for none.
   */
  listItemAction?: (line: number) => ReactNode
}

/**
 * The one way Ostler shows Markdown (N4.4a): sanitised, so scripts,
 * `javascript:` and other unknown schemes stay inert, with links to Ostler's
 * own items drawn as chips that show the item's current title (and a task's
 * status), whatever words the Markdown holds. A chip opens its item in Ostler;
 * an item that is gone reads "Deleted item". An `ostler-tasks` block is drawn
 * as a live list (N4.4c), one query for all of a text's blocks.
 */
export function Markdown({
  children,
  refreshKey,
  className,
  projectId,
  listItemAction
}: MarkdownProps) {
  // A link pasted as plain text is drawn as a link too, and so is a task's ID.
  const linked = useMemo(() => autolinkBareUrls(children), [children])
  const keys = useMemo(() => (projectId ? findTaskKeys(linked) : []), [linked, projectId])
  const keyUrls = useTaskKeyUrls(projectId, keys, refreshKey)
  const text = useMemo(() => linkTaskKeys(linked, keyUrls), [linked, keyUrls])
  const { toast } = useToast()
  const refs = useMemo(() => extractItemLinks(text, BRAND.urlScheme), [text])
  const info = useItemLinkInfo(refs, refreshKey)
  const blocks = useMemo(
    () => (projectId ? findLiveListBlocks(children).map((block) => block.body) : []),
    [children, projectId]
  )
  const lists = useLiveLists(projectId, blocks, refreshKey)
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children: words, node: _node, ...rest }) => {
        const ref = href ? itemLinkTarget(href, BRAND.urlScheme) : null
        const mentioned = href && !ref ? mentionPersonId(href, BRAND.urlScheme) : null
        if (mentioned) return <MentionChip personId={mentioned} />
        if (!ref) {
          // The window never navigates: a web link opens in the browser, a
          // file link in the project's folder, and any other link (`/risk`,
          // `#top`) does nothing.
          const web = href !== undefined && /^https?:/i.test(href)
          const file = web ? null : markdownFileTarget(href, projectId)
          return (
            <a
              href={href}
              {...rest}
              title={file ? t('common:markdown.openFileTitle', { path: file.path }) : undefined}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (web) void window.ostlerAPI.openExternalLink(href)
                else if (file)
                  void window.ostlerAPI
                    .openProjectFile(file.projectId, file.path)
                    .then((result) => {
                      if (!result.ok)
                        toast({
                          title: t('common:markdown.fileNotOpened'),
                          body: result.error,
                          tone: 'danger'
                        })
                    })
              }}
            >
              {words}
            </a>
          )
        }
        return <ItemLinkChip target={ref} info={info.get(refKey(ref))} words={words} />
      },
      img: ({ src, alt, node: _node, ...rest }) => {
        const shown = markdownImageSrc(typeof src === 'string' ? src : undefined)
        return shown ? (
          <img {...rest} src={shown} alt={alt ?? ''} className="ui-markdown-img" />
        ) : null
      },
      pre: ({ node, children: inner, ...rest }) => {
        const text = liveListText(node as HastNode | undefined)
        if (text === null) return <pre {...rest}>{inner}</pre>
        return (
          <LiveList
            body={liveListKey(text)}
            projectId={projectId}
            result={lists?.get(liveListKey(text))}
          />
        )
      },
      ...(listItemAction
        ? {
            li: ({ node, children: content, ...rest }) => {
              const line = node?.position?.start.line
              const action = line ? listItemAction(line - 1) : null
              return (
                <li {...rest}>
                  {content}
                  {action && <span className="ui-markdown-li-action">{action}</span>}
                </li>
              )
            }
          }
        : {})
    }),
    [info, lists, projectId, listItemAction, toast]
  )
  const body = (
    <ReactMarkdown
      rehypePlugins={[[rehypeSanitize, SCHEMA]]}
      urlTransform={markdownUrlTransform}
      components={components}
    >
      {text}
    </ReactMarkdown>
  )
  return className ? <div className={className}>{body}</div> : body
}
