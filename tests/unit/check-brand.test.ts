import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { checkBrand } from '../../scripts/check-brand.cjs'

const root = join(__dirname, '..', '..')
const brandSource = readFileSync(join(root, 'src', 'shared', 'brand.ts'), 'utf8')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const installerNsh = readFileSync(join(root, 'build', 'installer.nsh'), 'utf8')

describe('check-brand', () => {
  it('passes when package.json agrees with brand.ts', () => {
    expect(checkBrand(packageJson, brandSource, installerNsh)).toEqual([])
  })

  it('fails when the publisher or the release feed differ from BRAND', () => {
    const problems = checkBrand(
      {
        ...packageJson,
        author: 'Someone else',
        build: { ...packageJson.build, publish: [{ provider: 'github', owner: 'x', repo: 'y' }] }
      },
      brandSource
    )
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('author')
    expect(problems[1]).toContain('build.publish')
  })

  it('fails when the uninstaller would remove a different data folder from BRAND.dataFolderName', () => {
    const problems = checkBrand(packageJson, brandSource, '!define OSTLER_DATA_FOLDER "elsewhere"')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('OSTLER_DATA_FOLDER')
  })

  it('fails when build.productName differs from BRAND.fullName', () => {
    const problems = checkBrand(
      { ...packageJson, build: { ...packageJson.build, productName: 'Renamed' } },
      brandSource
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('build.productName')
  })

  it('fails when build.appId differs from BRAND.appUserModelId', () => {
    const problems = checkBrand(
      { ...packageJson, build: { ...packageJson.build, appId: 'com.other' } },
      brandSource
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('build.appId')
  })

  it('fails when the installer registers a different deep-link scheme from BRAND.urlScheme', () => {
    const problems = checkBrand(
      {
        ...packageJson,
        build: { ...packageJson.build, protocols: [{ name: 'Link', schemes: ['other'] }] }
      },
      brandSource
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('build.protocols')
  })
})
