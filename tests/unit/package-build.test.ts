import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { BRAND } from '@shared/brand'

/**
 * package.json's electron-builder `build` block (P10.1): what the installer
 * and the update feed are made from.
 */
const root = join(__dirname, '..', '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const build = packageJson.build

describe('package.json build', () => {
  it('names the app and its ids from BRAND', () => {
    expect(build.productName).toBe(BRAND.fullName)
    expect(build.appId).toBe(BRAND.appUserModelId)
    expect(packageJson.author).toBe(BRAND.publisher)
    expect(build.protocols[0].schemes).toEqual([BRAND.urlScheme])
  })

  it('points at icons that exist', () => {
    for (const icon of [
      build.win.icon,
      build.nsis.installerIcon,
      build.nsis.uninstallerIcon,
      build.nsis.installerHeaderIcon
    ]) {
      expect(icon).toMatch(/\.ico$/)
      expect(existsSync(join(root, icon)), icon).toBe(true)
    }
  })

  it('builds only the NSIS installer for x64; a portable exe is built on request', () => {
    const targets = build.win.target.map((entry: { target: string; arch: string[] }) => [
      entry.target,
      entry.arch
    ])
    expect(targets).toEqual([
      ['nsis', ['x64']]
    ])
    expect(packageJson.scripts['package:portable']).toContain('--win portable --x64')
  })

  it('makes an assisted, per-user installer with the brief’s choices', () => {
    expect(build.nsis).toMatchObject({
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      // build/installer.nsh asks, creates and removes the desktop shortcut.
      createDesktopShortcut: false,
      createStartMenuShortcut: true,
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
      include: 'build/installer.nsh'
    })
    expect(existsSync(join(root, build.nsis.include))).toBe(true)
  })

  it('shows the licence page only once a LICENSE file exists (P10.2)', () => {
    if (existsSync(join(root, 'LICENSE'))) expect(build.nsis.license).toBe('LICENSE')
    else expect(build.nsis.license).toBeUndefined()
  })

  it('ships the licence and the third-party notices beside the app (P10.2)', () => {
    const shipped = build.extraResources.map((entry: { from: string; to: string }) => entry.to)
    expect(shipped).toEqual(expect.arrayContaining(['THIRD_PARTY_NOTICES.md', 'LICENSE']))
    expect(existsSync(join(root, 'LICENSE'))).toBe(true)
    // The notices are generated into out/ by `npm run build`, which packaging runs first.
    const notices = build.extraResources.find(
      (entry: { from: string; to: string }) => entry.to === 'THIRD_PARTY_NOTICES.md'
    )
    expect(notices.from).toBe('out/THIRD_PARTY_NOTICES.md')
    expect(packageJson.scripts.build).toContain('generate-third-party-notices.cjs')
  })

  it('adds the uninstaller’s data checkbox and the optional desktop shortcut', () => {
    const nsh = readFileSync(join(root, build.nsis.include), 'utf8')
    expect(nsh).toContain('Also remove my Ostler data')
    expect(nsh).toContain(`!define OSTLER_DATA_FOLDER "${BRAND.dataFolderName}"`)
    expect(nsh).toContain('Create a desktop shortcut')
    // Updates never remove the data.
    expect(nsh).toMatch(/customUnInstall[\s\S]*\$\{IfNot\} \$\{isUpdated\}/)
  })

  it('publishes a draft GitHub release, and never pins a publisher unsigned builds would fail', () => {
    expect(build.publish).toEqual([
      { provider: 'github', owner: 'AntonyWiles', repo: 'ostler', releaseType: 'draft' }
    ])
    expect(BRAND.repositoryUrl).toBe('https://github.com/AntonyWiles/ostler')
    expect(build.win.publisherName).toBeUndefined()
    expect(build.win.verifyUpdateCodeSignature).toBeUndefined()
  })

  it('ships electron-updater as a production dependency', () => {
    expect(packageJson.dependencies['electron-updater']).toBeDefined()
  })
})
