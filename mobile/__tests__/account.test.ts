const mockGetTokens = jest.fn()
const mockClearCachedAccessToken = jest.fn()

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    getTokens: (...args: unknown[]) => mockGetTokens(...args),
    clearCachedAccessToken: (...args: unknown[]) => mockClearCachedAccessToken(...args)
  },
  isErrorWithCode: () => false,
  statusCodes: {}
}))

import { accessToken, discardToken } from '../src/google/account'

/** A token call that answers only when told to, so overlapping calls can be seen. */
function pendingTokens() {
  let answer: (token: string) => void = () => undefined
  mockGetTokens.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = (token) => resolve({ accessToken: token, idToken: '' })
      })
  )
  return (token: string) => answer(token)
}

beforeEach(() => {
  mockGetTokens.mockReset()
  mockClearCachedAccessToken.mockReset()
})

describe('accessToken', () => {
  it('shares one token call between callers that overlap', async () => {
    const answer = pendingTokens()
    const first = accessToken()
    const second = accessToken()
    await Promise.resolve()
    answer('tok')
    expect(await Promise.all([first, second])).toEqual(['tok', 'tok'])
    expect(mockGetTokens).toHaveBeenCalledTimes(1)
  })

  it('asks again once the last call has finished', async () => {
    mockGetTokens.mockResolvedValueOnce({ accessToken: 'one' })
    mockGetTokens.mockResolvedValueOnce({ accessToken: 'two' })
    expect(await accessToken()).toBe('one')
    expect(await accessToken()).toBe('two')
  })

  it('gives null when Google refuses, and the next call still works', async () => {
    mockGetTokens.mockRejectedValueOnce(new Error('SIGN_IN_REQUIRED'))
    mockGetTokens.mockResolvedValueOnce({ accessToken: 'back' })
    expect(await accessToken()).toBeNull()
    expect(await accessToken()).toBe('back')
  })

  it('does not start a token call while a discard is running', async () => {
    let finishDiscard: () => void = () => undefined
    mockClearCachedAccessToken.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishDiscard = resolve))
    )
    mockGetTokens.mockResolvedValueOnce({ accessToken: 'fresh' })
    const discarding = discardToken('old')
    const token = accessToken()
    await Promise.resolve()
    expect(mockGetTokens).not.toHaveBeenCalled()
    finishDiscard()
    await discarding
    expect(await token).toBe('fresh')
  })
})
