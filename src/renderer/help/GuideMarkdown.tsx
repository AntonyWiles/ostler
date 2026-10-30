import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { Link } from 'react-router-dom'
import { helpPath } from '../navigation/paths'
import { resolveGuideLink } from './guide'

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/**
 * Wraps every match of `query` in a page's text in `<mark>`. Runs after
 * sanitising, on text nodes only, so a search can never add markup of its own.
 */
export function rehypeHighlight(query: string) {
  const needle = query.trim().toLowerCase()
  return () => (tree: HastNode) => {
    if (!needle) return
    const visit = (node: HastNode) => {
      if (!node.children) return
      const next: HastNode[] = []
      for (const child of node.children) {
        if (child.type !== 'text' || !child.value) {
          visit(child)
          next.push(child)
          continue
        }
        const text = child.value
        const lower = text.toLowerCase()
        let from = 0
        let at = lower.indexOf(needle)
        if (at === -1) {
          next.push(child)
          continue
        }
        while (at !== -1) {
          if (at > from) next.push({ type: 'text', value: text.slice(from, at) })
          next.push({
            type: 'element',
            tagName: 'mark',
            properties: {},
            children: [{ type: 'text', value: text.slice(at, at + needle.length) }]
          })
          from = at + needle.length
          at = lower.indexOf(needle, from)
        }
        if (from < text.length) next.push({ type: 'text', value: text.slice(from) })
      }
      node.children = next
    }
    visit(tree)
  }
}

/**
 * A user guide page or the changelog as markdown. Raw HTML is never rendered
 * (react-markdown skips it) and the result is sanitised, so a `<script>` or a
 * `javascript:` link in a file can do nothing. Links to other pages open in
 * the guide, web links open in the browser, and images are not shown.
 */
export function GuideMarkdown({
  children,
  highlight = ''
}: {
  children: string
  highlight?: string
}) {
  return (
    <Markdown
      rehypePlugins={[rehypeSanitize, rehypeHighlight(highlight)]}
      components={{
        a: ({ href, children: label }) => <GuideLink href={href}>{label}</GuideLink>,
        img: () => null
      }}
    >
      {children}
    </Markdown>
  )
}

function GuideLink({ href, children }: { href?: string; children: ReactNode }) {
  const target = href ? resolveGuideLink(href) : null
  if (!target) return <>{children}</>
  if (target.kind === 'page') {
    // Headings carry no anchors, so a link within the page is plain text.
    if (!target.slug) return <>{children}</>
    return <Link to={helpPath(target.slug)}>{children}</Link>
  }
  return (
    <a
      href={target.url}
      onClick={(event) => {
        event.preventDefault()
        void window.ostlerAPI.openExternalLink(target.url)
      }}
    >
      {children}
    </a>
  )
}
