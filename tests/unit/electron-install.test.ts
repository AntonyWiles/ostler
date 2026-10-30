import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import * as electron from 'electron'
import { ensureElectronBinary, installedBinary } from '../../scripts/ensure-electron.cjs'

const nodeRequire = createRequire(import.meta.url)
const temps: string[] = []

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** A stand-in `electron` package whose installer writes a binary and counts its runs. */
function fakeElectronPackage(installer: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-fake-electron-'))
  temps.push(dir)
  fs.writeFileSync(path.join(dir, 'install.js'), installer)
  return dir
}

const WORKING_INSTALLER = `
const fs = require('fs'), path = require('path')
fs.appendFileSync(path.join(__dirname, 'runs.log'), 'run\\n')
const binary = path.join(__dirname, 'dist', 'electron.exe')
if (!fs.existsSync(binary)) {
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true })
  fs.writeFileSync(binary, '')
  fs.writeFileSync(path.join(__dirname, 'path.txt'), 'electron.exe')
}
`

describe('Electron in the test suites', () => {
  it('has its binary installed before any test worker starts', () => {
    // Nothing in a worker installs it any more (the alias below), so only the
    // global setup can have put it there.
    const electronDir = path.dirname(nodeRequire.resolve('electron/package.json'))
    const binary = installedBinary(electronDir)
    expect(binary).not.toBeNull()
    expect(fs.existsSync(binary as string)).toBe(true)
  })

  it('starts every test on screen, whatever the run was started with', async () => {
    // tests/setup-components.ts clears the switch before any module reads it.
    expect(process.env['OSTLER_OFF_SCREEN']).toBeUndefined()
    expect(process.env['OSTLER_ON_SCREEN']).toBeUndefined()
    const { offScreen } = await import('../../electron/app/off-screen')
    expect(offScreen).toBe(false)
  })

  it('gives tests a stand-in instead of the real package', () => {
    // The real package in Node is the binary's path and unpacks it when required.
    expect(electron).toHaveProperty('OUTSIDE_ELECTRON', true)
    expect('safeStorage' in electron).toBe(false)
  })
})

describe('ensureElectronBinary', () => {
  it('installs a missing binary and returns its path', () => {
    const dir = fakeElectronPackage(WORKING_INSTALLER)
    expect(installedBinary(dir)).toBeNull()
    expect(ensureElectronBinary(dir)).toBe(path.join(dir, 'dist', 'electron.exe'))
    expect(installedBinary(dir)).toBe(path.join(dir, 'dist', 'electron.exe'))
  })

  it('leaves an installed binary as it is', () => {
    const dir = fakeElectronPackage(WORKING_INSTALLER)
    ensureElectronBinary(dir)
    ensureElectronBinary(dir)
    expect(fs.readFileSync(path.join(dir, 'runs.log'), 'utf8')).toBe('run\nrun\n')
    expect(fs.readdirSync(path.join(dir, 'dist'))).toEqual(['electron.exe'])
  })

  it('fails clearly when the installer fails', () => {
    const dir = fakeElectronPackage('process.exit(3)')
    expect(() => ensureElectronBinary(dir)).toThrow(
      /Electron's binary is not installed .*installer exited with code 3/
    )
  })

  it('fails clearly when the installer leaves no binary', () => {
    const dir = fakeElectronPackage('')
    expect(() => ensureElectronBinary(dir)).toThrow(/no binary is in dist/)
  })
})
