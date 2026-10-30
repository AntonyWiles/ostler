import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import {
  policyFromJson,
  policyFromRegistry,
  policySummary,
  readPolicy
} from '../../electron/services/policy'
import { useTempDir } from '../helpers/temp-dir'

const REG = String.raw`
HKEY_LOCAL_MACHINE\Software\Policies\Ostler
    MicrosoftClientId    REG_SZ    11111111-2222-3333-4444-555555555555
    MicrosoftTenant    REG_SZ    contoso.onmicrosoft.com
    ForbiddenProviders    REG_SZ    dropbox, google
    SyncServerUrl    REG_SZ    https://sync.contoso.com/
    DisableAgents    REG_DWORD    0x1
`

describe("an organisation's policy (integrations phase 7)", () => {
  const root = useTempDir('ostler-policy-')

  it('reads registry values as Group Policy and Intune write them', () => {
    expect(policyFromRegistry(REG)).toEqual({
      apps: {
        microsoft: {
          clientId: '11111111-2222-3333-4444-555555555555',
          tenant: 'contoso.onmicrosoft.com'
        }
      },
      forbiddenProviders: ['google', 'dropbox'],
      syncServer: { url: 'https://sync.contoso.com', signIn: 'key' },
      disableAgents: true
    })
    expect(policyFromRegistry('')).toEqual({})
  })

  it('leaves out what is badly formed, and never guesses', () => {
    expect(
      policyFromJson({
        apps: { google: { clientId: 'x' }, dropbox: { clientId: 'abcdefgh12' } },
        forbiddenProviders: ['dropbox', 'myspace'],
        syncServer: { url: 'http://sync.example.com' },
        disableAi: 'yes'
      })
    ).toEqual({ apps: { dropbox: { clientId: 'abcdefgh12' } }, forbiddenProviders: ['dropbox'] })
    // Signing in with Microsoft needs the server's scope.
    expect(
      policyFromJson({ syncServer: { url: 'https://sync.example.com', signIn: 'microsoft' } })
    ).toEqual({})
  })

  it('reads the file and the registry, and the registry wins', async () => {
    fs.mkdirSync(path.join(root(), 'Ostler'))
    fs.writeFileSync(
      path.join(root(), 'Ostler', 'policy.json'),
      '﻿' +
        JSON.stringify({
          apps: { google: { clientId: 'google-client-1' } },
          forbiddenProviders: ['caldav'],
          disableAi: true,
          disableAgents: false
        })
    )
    const policy = await readPolicy({ programData: root(), registry: async () => REG })
    expect(policy.apps.google?.clientId).toBe('google-client-1')
    expect(policy.apps.microsoft?.tenant).toBe('contoso.onmicrosoft.com')
    expect(policy.forbiddenProviders).toEqual(['google', 'dropbox'])
    expect(policy.disableAi).toBe(true)
    expect(policy.disableAgents).toBe(true)
    expect(policySummary(policy)).toEqual({
      managed: true,
      forbiddenProviders: ['google', 'dropbox'],
      appsFor: ['google', 'microsoft'],
      syncServer: { url: 'https://sync.contoso.com', signIn: 'key' },
      disableAi: true,
      disableAgents: true
    })
  })

  it('is nothing at all when neither place has one, or the file is broken', async () => {
    fs.mkdirSync(path.join(root(), 'Ostler'))
    fs.writeFileSync(path.join(root(), 'Ostler', 'policy.json'), '{ not json')
    const logged: string[] = []
    const policy = await readPolicy({
      programData: root(),
      registry: async () => {
        throw new Error('no key')
      },
      log: (line) => logged.push(line)
    })
    expect(policySummary(policy).managed).toBe(false)
    expect(logged).toHaveLength(1)
  })

  it('turns AI and agents off over the saved settings, without saving over them', () => {
    const file = path.join(root(), 'config.json')
    const store = new ConfigStore(file)
    store.update({ ai: { model: 'gpt-4o' }, harness: { enabled: true } })
    store.setPolicy({ disableAi: true, disableAgents: true })
    expect(store.get().ai.model).toBe('')
    expect(store.get().harness.enabled).toBe(false)

    // Saving anything else keeps what the person chose underneath.
    store.update({ ai: { model: 'other' }, harness: { enabled: false }, ui: { theme: 'dark' } })
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(saved.ai.model).toBe('gpt-4o')
    expect(saved.harness.enabled).toBe(true)

    store.setPolicy({ disableAi: false, disableAgents: false })
    expect(store.get().ai.model).toBe('gpt-4o')
    expect(store.get().harness.enabled).toBe(true)
  })
})
