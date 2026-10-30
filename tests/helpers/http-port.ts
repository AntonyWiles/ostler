import net from 'node:net'

/**
 * Starts a test's HTTP server on a port no one else is using, and resolves
 * with that port once the server accepts connections.
 *
 * A fixed port is shared with every other run of the same test file: two
 * checkouts running the integration suite at once (separate worktrees can)
 * both asked for it. The second server could not listen, which the app logs
 * and carries on from, as it should, and that run's requests went to the
 * first run's server, answered from another database. A port the system has
 * just handed out is outside the range the suites name, and waiting until it
 * accepts connections replaces a fixed pause that only hoped it was ready.
 */
export async function startOnFreePort(start: (port: number) => void): Promise<number> {
  const port = await freePort()
  start(port)
  await acceptsConnections(port)
  return port
}

/**
 * A port the system has just handed out and nothing listens on, for a test
 * that needs an address where no server answers. `PORT + 1` is not that: in
 * a parallel run another file's server may have been given it.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('No free port'))))
    })
  })
}

async function acceptsConnections(port: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (connected) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`The test server did not start listening on 127.0.0.1:${port}`)
}
