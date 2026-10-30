import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { build, policyPage } from '../../scripts/build-privacy-page.cjs'

describe('privacy page', () => {
  it('turns the policy into a page titled from its heading, with tables that scroll', () => {
    const html = policyPage('# Ostler privacy policy\n\n| A | B |\n| - | - |\n| 1 | 2 |\n')
    expect(html).toContain('<title>Ostler privacy policy</title>')
    expect(html).toContain('<h1>Ostler privacy policy</h1>')
    expect(html).toContain('<div class="table"><table>')
  })

  it('builds the site from the real policy, served without Jekyll', () => {
    const site = build(fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-page-')))
    expect(fs.existsSync(path.join(site, '.nojekyll'))).toBe(true)
    const page = fs.readFileSync(path.join(site, 'privacy', 'index.html'), 'utf8')
    expect(page).toContain('Google API Services User Data Policy')
    expect(page).toContain('GPL-3.0')
    fs.rmSync(site, { recursive: true, force: true })
  })
})
