// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIConnectionDraft, AIEffortSetting, AIModelEffortSupport } from '@shared/ostler-api'
import { EffortField } from '@renderer/views/settings/EffortField'
import { installOstlerApi } from '../../fixtures/ostler-api'

let onChange: ReturnType<typeof vi.fn>

function renderField(
  model: string,
  support: AIModelEffortSupport | string,
  { effort = '', draft }: { effort?: AIEffortSetting; draft?: AIConnectionDraft } = {}
) {
  const getAIModelEffortSupport = vi.fn(async () =>
    typeof support === 'string'
      ? { ok: false as const, error: support }
      : { ok: true as const, value: support }
  )
  installOstlerApi({ getAIModelEffortSupport })
  render(
    <EffortField
      model={model}
      cacheKey="test"
      draft={draft}
      effort={effort}
      onChange={onChange as (effort: AIEffortSetting) => void}
    />
  )
  return getAIModelEffortSupport
}

const option = (name: string) => screen.getByRole('option', { name }) as HTMLOptionElement

describe('EffortField', () => {
  beforeEach(() => {
    onChange = vi.fn()
  })

  it('offers only the levels the provider named and greys out the rest', async () => {
    renderField('model-a', {
      model: 'model-a',
      levels: ['low', 'medium', 'high'],
      source: 'listing'
    })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Effort' })).toBeEnabled())
    expect(option('Low').disabled).toBe(false)
    expect(option('High').disabled).toBe(false)
    expect(option('Extra high').disabled).toBe(true)
    expect(option('Max').disabled).toBe(true)
  })

  it('greys the whole field out for a model with no effort setting', async () => {
    renderField('model-b', { model: 'model-b', levels: [], source: 'listing' })
    expect(
      await screen.findByText('model-b has no effort setting, according to its provider.')
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Effort' })).toBeDisabled()
  })

  it('clears a saved level the new model does not take', async () => {
    renderField('model-c', { model: 'model-c', levels: ['low'], source: 'test' }, { effort: 'max' })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''))
  })

  it('asks about the connection it is given', async () => {
    const draft: AIConnectionDraft = { provider: 'anthropic', model: 'model-e' }
    const check = renderField(
      'model-e',
      { model: 'model-e', levels: ['low'], source: 'listing' },
      { draft }
    )
    await waitFor(() => expect(check).toHaveBeenCalledWith(draft))
  })

  it('stays greyed out and says why when the check fails', async () => {
    renderField('model-d', 'bad key')
    expect(
      await screen.findByText(/Couldn't check which levels model-d takes: bad key/)
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Effort' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument()
  })
})
