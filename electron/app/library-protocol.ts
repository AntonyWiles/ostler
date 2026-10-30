import { protocol } from 'electron'
import * as fs from 'fs'
import type { WatchedProject } from '@shared/ostler-api'
import type { LibraryService } from '../services/library-service'

// Library images reach the sandboxed renderer through this scheme. It must be
// registered before the app is ready; the handler is installed in whenReady.
// Not `standard`: standard schemes lowercase the host, which holds a project id.
const LIBRARY_SCHEME = 'ostler-library'
// The pictures in agents' reports (N9.1), served the same way and read-only.
export const REPORT_PICTURE_SCHEME = 'ostler-report-picture'
export function registerLibraryScheme(): void {
  // One call registers every privileged scheme: a second call would replace the first.
  protocol.registerSchemesAsPrivileged([
    { scheme: LIBRARY_SCHEME, privileges: { secure: true, supportFetchAPI: true, stream: true } },
    {
      scheme: REPORT_PICTURE_SCHEME,
      privileges: { secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * `ostler-report-picture://<projectId>/<sessionId>/<name>`: one picture from a
 * session's report. Ids and a stored name only; HarnessService checks the
 * session belongs to the project and the name is one it wrote.
 */
export function installReportPictureProtocol(
  getProject: (projectId: string) => WatchedProject,
  readPicture: (
    project: WatchedProject,
    sessionId: string,
    name: string
  ) => { bytes: Buffer; mimeType: string } | null
): void {
  protocol.handle(REPORT_PICTURE_SCHEME, async (request) => {
    const notFound = () => new Response('Not found', { status: 404 })
    try {
      const parts = request.url
        .slice(`${REPORT_PICTURE_SCHEME}://`.length)
        .split(/[?#]/)[0]
        .split('/')
        .filter(Boolean)
        .map((part) => decodeURIComponent(part))
      if (parts.length !== 3) return notFound()
      const [projectId, sessionId, name] = parts
      const picture = readPicture(getProject(projectId), sessionId, name)
      if (!picture) return notFound()
      return new Response(new Uint8Array(picture.bytes), {
        status: 200,
        headers: {
          'Content-Type': picture.mimeType,
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    } catch {
      return notFound()
    }
  })
}

/** Installs the handler; called once the app is ready and the Library is open. */
export function installLibraryProtocol(
  getProject: (projectId: string) => WatchedProject,
  libraryService: LibraryService
): void {
  protocol.handle(LIBRARY_SCHEME, (request) =>
    handleLibraryRequest(request, getProject, libraryService)
  )
}

/**
 * `ostler-library://<projectId>/<itemId>/(file|thumb)`. The URL carries ids
 * only; the project must be registered, and LibraryService resolves the file.
 * Anything else is a 404.
 */
async function handleLibraryRequest(
  request: Request,
  getProject: (projectId: string) => WatchedProject,
  libraryService: LibraryService
): Promise<Response> {
  const notFound = () => new Response('Not found', { status: 404 })
  try {
    const rest = request.url.slice(`${LIBRARY_SCHEME}://`.length).split(/[?#]/)[0]
    const parts = rest
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part))
    if (parts.length !== 3) return notFound()
    const [projectId, itemId, which] = parts
    // A PDF's page drawn as a picture: page-1, page-2...
    const page = /^page-([1-9]\d{0,4})$/.exec(which)
    if (which !== 'file' && which !== 'thumb' && !page) return notFound()
    const project = getProject(projectId)
    const stored = page
      ? await libraryService.pdfPagePreview(project.id, itemId, Number(page[1]))
      : libraryService.storedFile(project.id, itemId, which as 'file' | 'thumb')
    if (!stored) return notFound()
    const bytes = await fs.promises.readFile(stored.path)
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': stored.mimeType,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch {
    return notFound()
  }
}
