import { describe, it, expect } from 'vitest'
import {
  isEncryptionAvailable,
  encryptApiKey,
  decryptApiKey,
  openSecret,
  sealSecret
} from '../../electron/safe-storage'

describe('safe-storage.ts', () => {
  it('handles empty API keys safely', () => {
    expect(encryptApiKey('')).toBe('')
    expect(decryptApiKey('')).toBe('')
  })

  it('keeps a secret plain when safeStorage is unavailable, and opens it as it is', () => {
    if (isEncryptionAvailable()) return
    const rawKey = 'sk-test-secret-key-12345'
    expect(sealSecret(rawKey)).toBe(rawKey)
    expect(openSecret(rawKey)).toBe(rawKey)
    expect(() => openSecret('ostler-secure:v1:AAAA')).toThrow(/Secure credential storage/)
  })
})
