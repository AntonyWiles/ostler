import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Theme and size rules no component test can see: what Windows high contrast
 * keeps, and how the newer screens fit a 900 px window and compact density.
 * Read from the stylesheets themselves, so removing a rule fails here.
 */

const renderer = join(__dirname, '..', '..', 'src', 'renderer')
const css = (file: string): string =>
  readFileSync(join(renderer, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The text of every `@media`/`@container` block whose prelude matches. */
function blocks(source: string, prelude: RegExp): string {
  const found: string[] = []
  const opener = /@(?:media|container)[^{]*\{/g
  let match
  while ((match = opener.exec(source))) {
    let depth = 1
    let end = match.index + match[0].length
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') depth -= 1
      end += 1
    }
    if (prelude.test(match[0])) found.push(source.slice(match.index, end))
  }
  return found.join('\n')
}

const forced = (file: string): string => blocks(css(file), /forced-colors:\s*active/)

/** The declarations of every rule in `block` that lists `selector` exactly. */
function rule(block: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|[{},])\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'gm')
  return [...block.matchAll(pattern)].map((match) => match[1]).join('\n')
}

describe('Windows high contrast (forced colours)', () => {
  it('marks where a dragged row lands, since box-shadows are removed', () => {
    const base = forced('styles/base.css')
    expect(rule(base, '.is-drop-before')).toMatch(/border-top:.*Highlight/)
    expect(rule(base, '.is-drop-after')).toMatch(/border-bottom:.*Highlight/)
  })

  it('outlines the Library banner and filter you picked', () => {
    const base = forced('styles/base.css')
    expect(base).toContain('.ostler-library-banner.selected')
    expect(base).toContain('.ostler-library-rail-item.active')
  })

  it('keeps days off and hours outside the working day apart', () => {
    expect(rule(forced('ui/CalendarGrid.css'), '.ui-calendar__day.is-day-off')).toMatch(
      /outline:.*dashed CanvasText/
    )
    expect(
      rule(forced('views/planning/calendar/CalendarYear.css'), '.calendar-year__grid .is-day-off')
    ).toMatch(/outline:.*dashed CanvasText/)
    const hours = rule(
      forced('views/planning/calendar/WeekHours.css'),
      '.week-hours__cell.is-outside'
    )
    expect(hours).toMatch(/forced-color-adjust:\s*none/)
    expect(hours).toContain('GrayText')
  })

  it('draws focus as an outline where the normal ring is a box-shadow', () => {
    for (const [file, selector] of [
      ['ui/CalendarGrid.css', '.ui-calendar__day:focus-visible'],
      ['components/DiffPatch.css', '.diff-patch__number--button:focus-visible'],
      ['views/planning/DescriptionHistory.css', '.description-history__version:focus-visible']
    ]) {
      expect(rule(forced(file), selector), `${file} ${selector}`).toMatch(
        /outline:.*solid Highlight/
      )
    }
  })

  it('shows the bar only on highlighted or picked lines', () => {
    const diff = forced('components/DiffPatch.css')
    expect(rule(diff, '.diff-patch__line')).toMatch(/border-left-color:\s*Canvas\b/)
    expect(rule(diff, '.diff-patch__line--highlight')).toMatch(/Highlight/)
    const history = forced('views/planning/DescriptionHistory.css')
    expect(rule(history, '.description-history__version')).toMatch(/border-left-color:\s*Canvas\b/)
    expect(rule(history, '.description-history__version.is-selected')).toMatch(/Highlight/)
  })

  it('outlines the row being edited and the goal you came to', () => {
    expect(rule(forced('costs/costs.css'), '.costs-table__row--editing')).toMatch(/Highlight/)
    expect(rule(forced('shopping/shopping.css'), '.shopping-row--editing')).toMatch(/Highlight/)
    expect(rule(forced('views/goals/GoalsView.css'), '.goals-view__goal.is-highlighted')).toMatch(
      /Highlight/
    )
  })

  it('keeps bars that are fills: the budget, rounds and charts', () => {
    const costs = forced('costs/costs.css')
    expect(costs).toMatch(/\.budget-card__bar-paid,\s*\.budget-card__bar-planned\s*\{[^}]*none/)
    expect(rule(costs, '.budget-card__bar-paid')).toContain('Highlight')
    expect(rule(costs, '.budget-card__bar-planned')).toContain('repeating-linear-gradient')
    expect(rule(costs, '.budget-card__bar[data-over]')).toContain('border-width')
    expect(
      rule(forced('views/planning/rounds/rounds.css'), '.compare-rounds__bar.is-took')
    ).toMatch(/forced-color-adjust:\s*none[\s\S]*CanvasText/)
    const charts = forced('ui/charts/charts.css')
    for (const selector of ['.ui-chart__line', '.ui-chart__area', '.ui-chart__point']) {
      expect(charts).toContain(selector)
    }
  })

  it('gives every box of a board an edge once fills are gone', () => {
    expect(rule(forced('views/planning/matrix/MatrixView.css'), '.matrix-box')).toContain(
      'CanvasText'
    )
    expect(rule(forced('views/planning/ideas/IdeaGrid.css'), '.idea-grid__cell')).toContain(
      'CanvasText'
    )
    expect(rule(forced('views/home/ProjectStageBoard.css'), '.project-stage-column')).toContain(
      'CanvasText'
    )
  })

  it("keeps a project's and a calendar's own colour marks", () => {
    expect(rule(forced('views/home/BriefingCard.css'), '.ostler-briefing__dot')).toMatch(
      /forced-color-adjust:\s*none/
    )
    expect(
      rule(forced('components/calendar-events/calendar-events.css'), '.calendar-event::before')
    ).toMatch(/forced-color-adjust:\s*none/)
  })
})

describe('A 900 px window', () => {
  it('puts the Library item under the list when the view is narrow', () => {
    const narrow = blocks(
      css('views/project-detail/library/LibraryPanel.css'),
      /project-detail\s*\(max-width:\s*900px\)/
    )
    expect(rule(narrow, '.ostler-library')).toMatch(/grid-template-columns:[^;]*minmax\(0, 1fr\);/)
    expect(rule(narrow, '.ostler-library-detail')).toContain('grid-column: 1 / -1')
    // Two columns: the editor may not reach for a third.
    expect(rule(narrow, '.ostler-library-editor')).toContain('grid-column: 2 / -1')
  })

  it('moves the Someday tray under the grid below 1000 px', () => {
    const narrow = blocks(css('views/planning/ideas/IdeaGrid.css'), /width\s*<\s*1000px/)
    expect(rule(narrow, '.idea-board__body')).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  it('lets the Costs editing row shrink and the table scroll in its own box', () => {
    const costs = css('costs/costs.css')
    expect(rule(costs, '.costs-table-scroll')).toContain('overflow-x: auto')
    expect(costs).toMatch(
      /\.costs-table__row--editing input,\s*\.costs-table__row--editing select\s*\{\s*width: 100%;/
    )
  })

  it('wraps rounds, and a contact’s header, rather than overflowing', () => {
    expect(rule(css('views/planning/rounds/rounds.css'), '.compare-rounds__bars')).toContain(
      'flex-wrap: wrap'
    )
    expect(rule(css('contacts/contacts.css'), '.contact-detail__header')).toContain(
      'flex-wrap: wrap'
    )
  })
})

describe('Compact density', () => {
  it('sizes the Agenda rows from the control height', () => {
    const agenda = css('views/planning/calendar/CalendarAgenda.css')
    expect(agenda).not.toContain('var(--space-800)')
    expect(rule(agenda, '.calendar-agenda__milestone')).toContain(
      'min-height: var(--control-height)'
    )
  })
})
