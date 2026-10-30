// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Person } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'
import { StaticPeopleProvider } from '@renderer/context/PeopleContext'
import { CommentComposer } from '@renderer/views/planning/ActivityList'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

afterEach(() => __resetDismissableStackForTests())

const P = '0f8fad5b-d9cb-469f-a165-70867728950e'
const ANA = '5b1f0d6e-1c3a-4e0a-9d0a-111111111111'
const ANDY = '5b1f0d6e-1c3a-4e0a-9d0a-222222222222'
const BEN = '5b1f0d6e-1c3a-4e0a-9d0a-333333333333'

const person = (id: string, name: string): Person => ({
  id,
  name,
  initials: name.slice(0, 2).toUpperCase(),
  color: '#336699',
  isMe: false,
  archivedAt: null,
  weeklyCapacityHours: null,
  workingDays: [1, 2, 3, 4, 5],
  projectId: null,
  createdAt: 0,
  updatedAt: 0
})

const PEOPLE = [person(BEN, 'Ben'), person(ANA, 'Ana'), person(ANDY, 'Andy')]

const shell = (ui: React.ReactElement) => (
  <MemoryRouter>
    <ConfirmProvider>
      <ToastProvider>
        <StaticPeopleProvider people={PEOPLE}>{ui}</StaticPeopleProvider>
      </ToastProvider>
    </ConfirmProvider>
  </MemoryRouter>
)

const area = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement

/** Types into a textarea as a person would: focused, caret at the end. */
function typeInto(el: HTMLTextAreaElement, text: string) {
  el.focus()
  fireEvent.change(el, { target: { value: text } })
  el.setSelectionRange(text.length, text.length)
  fireEvent.select(el)
}

describe('typing @ in a comment (prompt 14)', () => {
  it('offers matching people and Enter inserts the mention link', async () => {
    installOstlerApi()
    const onSubmit = vi.fn(async () => true)
    render(shell(<CommentComposer projectId={P} onSubmit={onSubmit} />))
    typeInto(area(), 'Can you check this @an')

    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent?.replace(/^[A-Z]{2}/, ''))).toEqual([
      'Ana',
      'Andy'
    ])
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(area(), { key: 'Enter' })
    expect(area().value).toBe(`Can you check this [@Ana](${BRAND.urlScheme}://person/${ANA}) `)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('leaves the typed text on Escape', async () => {
    installOstlerApi()
    render(shell(<CommentComposer projectId={P} onSubmit={async () => true} />))
    typeInto(area(), '@an')
    await screen.findByRole('listbox')
    fireEvent.keyDown(area(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(area().value).toBe('@an')
  })

  it('does not open for an @ inside a word, such as an email address', () => {
    installOstlerApi()
    render(shell(<CommentComposer projectId={P} onSubmit={async () => true} />))
    typeInto(area(), 'write to ana@an')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
