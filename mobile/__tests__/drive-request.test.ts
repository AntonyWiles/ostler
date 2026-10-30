import { createDriveRequest, SignInRequiredError } from '../src/google/drive-request'

function reply(status: number, body = ''): Response {
  return new Response(body, { status })
}

function setup(responses: Response[], tokens: (string | null)[] = ['one', 'two']) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const discarded: string[] = []
  const fetchStub = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers })
    return responses.shift() as Response
  }) as unknown as typeof fetch
  const request = createDriveRequest({
    accessToken: async () => tokens.shift() ?? null,
    discardToken: async (token) => {
      discarded.push(token)
    },
    fetch: fetchStub
  })
  return { request, calls, discarded }
}

const URL_OK = 'https://www.googleapis.com/drive/v3/files'

describe('createDriveRequest', () => {
  it('sends the bearer token and returns status and bytes', async () => {
    const { request, calls } = setup([reply(200, 'hi')])
    const response = await request({ method: 'GET', url: URL_OK })
    expect(response.status).toBe(200)
    expect(new TextDecoder().decode(response.bytes)).toBe('hi')
    expect(calls[0].headers.Authorization).toBe('Bearer one')
  })

  it('refuses any host but www.googleapis.com', async () => {
    const { request, calls } = setup([reply(200)])
    await expect(request({ method: 'GET', url: 'https://evil.example/drive' })).rejects.toThrow(
      /only www.googleapis.com/
    )
    await expect(request({ method: 'GET', url: 'http://www.googleapis.com/x' })).rejects.toThrow()
    await expect(request({ method: 'GET', url: 'not a url' })).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('retries once with a new token after a 401', async () => {
    const { request, calls, discarded } = setup([reply(401), reply(200, 'ok')])
    const response = await request({ method: 'GET', url: URL_OK })
    expect(response.status).toBe(200)
    expect(discarded).toEqual(['one'])
    expect(calls[1].headers.Authorization).toBe('Bearer two')
  })

  it('asks for a new sign-in after a second 401 or with no token', async () => {
    const twice = setup([reply(401), reply(401)])
    await expect(twice.request({ method: 'GET', url: URL_OK })).rejects.toBeInstanceOf(
      SignInRequiredError
    )
    const none = setup([reply(200)], [null])
    await expect(none.request({ method: 'GET', url: URL_OK })).rejects.toBeInstanceOf(
      SignInRequiredError
    )
  })
})
