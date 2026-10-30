/**
 * A name Windows accepts for a file or folder the person saves: no reserved
 * or control characters, no trailing dots or spaces. Used for the default
 * name in every Save dialog (templates, exports, PDFs).
 */
export function safeFileName(name: string, fallback = 'Project'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned || fallback
}
