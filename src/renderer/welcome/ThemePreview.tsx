import type { ThemeSetting } from '@shared/ostler-api'

/**
 * A small picture of the app in a theme: a sidebar, a header and three
 * cards, drawn with that theme's own tokens (`data-theme` on the picture), so
 * the welcome can show Light and Dark side by side. System shows both halves.
 */
export function ThemePreview({ theme }: { theme: ThemeSetting }) {
  if (theme === 'system') {
    return (
      <span className="ostler-theme-preview ostler-theme-preview--split" aria-hidden="true">
        <Picture theme="light" />
        <Picture theme="dark" />
      </span>
    )
  }
  return (
    <span className="ostler-theme-preview" aria-hidden="true">
      <Picture theme={theme} />
    </span>
  )
}

function Picture({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <span className="ostler-theme-preview__picture" data-theme={theme}>
      <span className="ostler-theme-preview__sidebar" />
      <span className="ostler-theme-preview__main">
        <span className="ostler-theme-preview__bar" />
        <span className="ostler-theme-preview__cards">
          <span className="ostler-theme-preview__card is-accent" />
          <span className="ostler-theme-preview__card" />
          <span className="ostler-theme-preview__card" />
        </span>
      </span>
    </span>
  )
}
