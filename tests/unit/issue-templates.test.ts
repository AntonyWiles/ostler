import { readdirSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * The GitHub issue forms (P10.2) parse as YAML and carry the keys GitHub's
 * issue-form schema requires, so a broken form fails here rather than
 * silently falling back to a blank issue on GitHub. js-yaml is already in the
 * dev tree (through ESLint); it is loaded untyped rather than added as a dependency.
 */

const load = (createRequire(__filename)('js-yaml') as { load: (text: string) => unknown }).load
const dir = resolve(__dirname, '../../.github/ISSUE_TEMPLATE')
const BODY_TYPES = new Set(['markdown', 'textarea', 'input', 'dropdown', 'checkboxes'])

type Element = {
  type: string
  id?: string
  attributes?: { label?: string; value?: string; options?: unknown[] }
}

const read = (file: string) =>
  load(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>
const forms = readdirSync(dir).filter((file) => file.endsWith('.yml') && file !== 'config.yml')

describe('issue templates', () => {
  it('has a bug report and a feature request form', () => {
    expect(forms.sort()).toEqual(['bug_report.yml', 'feature_request.yml'])
  })

  it.each(forms)('%s is a valid issue form', (file) => {
    const form = read(file)
    expect(typeof form.name).toBe('string')
    expect(typeof form.description).toBe('string')
    const body = form.body as Element[]
    expect(Array.isArray(body) && body.length > 0).toBe(true)
    const ids = new Set<string>()
    for (const element of body) {
      expect(BODY_TYPES.has(element.type)).toBe(true)
      if (element.type === 'markdown') {
        expect(typeof element.attributes?.value).toBe('string')
        continue
      }
      expect(typeof element.attributes?.label).toBe('string')
      if (element.id) {
        expect(ids.has(element.id)).toBe(false)
        ids.add(element.id)
      }
      if (element.type === 'dropdown')
        expect(element.attributes?.options?.length).toBeGreaterThan(0)
    }
  })

  it('asks a bug report for the Copy diagnostics output', () => {
    const body = read('bug_report.yml').body as Element[]
    const diagnostics = body.find((element) => element.id === 'diagnostics')
    expect(JSON.stringify(diagnostics)).toContain('Copy diagnostics')
  })

  it('links the user guide from the template chooser', () => {
    const config = read('config.yml') as { contact_links: Array<{ name: string; url: string }> }
    const guide = config.contact_links.find((link) => link.name === 'User guide')
    expect(guide?.url).toMatch(/docs\/user-guide\//)
  })
})
