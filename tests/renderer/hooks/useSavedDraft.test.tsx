// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSavedDraft } from '@renderer/hooks/useSavedDraft'

function Field({ saved }: { saved: string }) {
  const [draft, setDraft] = useSavedDraft(saved)
  return (
    <input aria-label="Field" value={draft} onChange={(event) => setDraft(event.target.value)} />
  )
}

/** The pattern useSavedDraft replaced, kept here to show the race it had. */
function EffectField({ saved }: { saved: string }) {
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  return (
    <input aria-label="Field" value={draft} onChange={(event) => setDraft(event.target.value)} />
  )
}

type Act = { IS_REACT_ACT_ENVIRONMENT?: boolean }

/**
 * Mounts the field the way a load finishing mounts it in the app: in a render
 * React schedules itself, outside act. The person types as soon as the field
 * is on screen, before React has run that render's effects, and the test then
 * reads what is left in the field once everything has settled.
 */
async function typeAsSoonAsItAppears(Component: typeof Field): Promise<string> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const environment = globalThis as Act
  const before = environment.IS_REACT_ACT_ENVIRONMENT
  environment.IS_REACT_ACT_ENVIRONMENT = false
  try {
    const field = await new Promise<HTMLInputElement>((resolve) => {
      const observer = new MutationObserver(() => {
        const input = container.querySelector('input')
        if (!input) return
        observer.disconnect()
        resolve(input)
      })
      observer.observe(container, { childList: true, subtree: true })
      root.render(<Component saved="" />)
    })
    fireEvent.change(field, { target: { value: 'npm run dev' } })
    await new Promise((resolve) => setTimeout(resolve, 50))
    return field.value
  } finally {
    root.unmount()
    container.remove()
    environment.IS_REACT_ACT_ENVIRONMENT = before
  }
}

describe('useSavedDraft', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('starts as the saved value and keeps what the person types', () => {
    const { rerender } = render(<Field saved="npm test" />)
    const field = screen.getByRole('textbox', { name: 'Field' })
    expect(field).toHaveValue('npm test')
    fireEvent.change(field, { target: { value: 'npm run dev' } })
    rerender(<Field saved="npm test" />)
    expect(field).toHaveValue('npm run dev')
  })

  it('goes back to the saved value when the saved value changes', () => {
    const { rerender } = render(<Field saved="npm test" />)
    const field = screen.getByRole('textbox', { name: 'Field' })
    fireEvent.change(field, { target: { value: 'typing' } })
    rerender(<Field saved="npm run preview" />)
    expect(field).toHaveValue('npm run preview')
  })

  it('keeps a keystroke made before the render that showed the field has run its effects', async () => {
    expect(await typeAsSoonAsItAppears(Field)).toBe('npm run dev')
  })

  it('is checked by a race the mount effect it replaced loses', async () => {
    expect(await typeAsSoonAsItAppears(EffectField)).toBe('')
  })
})
