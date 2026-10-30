import { MAIN_CONTENT_ID, focusPageContent } from './route-focus'
import { t } from '@shared/i18n'

/**
 * "Skip to content" (P9.2, WCAG 2.4.1): the first stop for Tab, past the
 * title bar and sidebar to the page's heading. Hidden until it has focus.
 */
export function SkipLink() {
  return (
    <a
      className="ostler-skip-link"
      href={`#${MAIN_CONTENT_ID}`}
      onClick={(event) => {
        // The router keeps its own location; the page's hash is left alone.
        event.preventDefault()
        focusPageContent()
      }}
    >
      {t('navigation:skipLink.skipContent')}
    </a>
  )
}
