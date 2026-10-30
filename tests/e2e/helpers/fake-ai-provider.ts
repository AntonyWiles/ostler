import * as http from 'node:http'

export interface FakeAiProvider {
  server: http.Server
  port: number
  /** The body of the last request the provider was sent, '' before any. */
  lastRequestBody: () => string
}

/**
 * An OpenAI-style provider on this computer that streams `content` back as one
 * chunk to every request, and keeps what it was sent. Close `server` after the test.
 */
export async function startFakeAiProvider(content: string): Promise<FakeAiProvider> {
  let lastRequestBody = ''
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      lastRequestBody = body
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`
      )
    })
  })
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to start the E2E AI provider'))
        return
      }
      resolve(address.port)
    })
  })
  return { server, port, lastRequestBody: () => lastRequestBody }
}
