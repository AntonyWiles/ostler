import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'

/**
 * Markdown for the shareable report (R4.1, D37), rendered with the same
 * `react-markdown` and `rehype-sanitize` the app shows it with. The page makes
 * no requests and points nowhere, so a link keeps only its text and an image
 * only its alternative text: no `http:`, `https:` or `ostler-library:` URL
 * reaches the file.
 */
export function renderShareMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    createElement(
      Markdown,
      {
        rehypePlugins: [rehypeSanitize],
        urlTransform: () => '',
        components: {
          a: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
          img: ({ alt }: { alt?: string }) => (alt ? createElement('span', null, `[${alt}]`) : null)
        }
      },
      markdown
    )
  )
}
