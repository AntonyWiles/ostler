// node:zlib for any engine file that still imports it directly; `src/platform.ts` has the
// real implementation (with the output limit), this re-exports it.
export { gunzipSync, gzipSync } from '../src/platform'
