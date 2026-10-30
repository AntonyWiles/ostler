// Load Monaco's prebuilt files from the local renderer assets instead of a
// CDN. Vite serves the same copied `vs` directory in development and includes
// it in packaged builds, keeping the editor offline without making Rollup
// transform the complete Monaco distribution.
import { loader } from '@monaco-editor/react'

loader.config({
  paths: {
    vs: import.meta.env.DEV ? '/vs' : './vs'
  }
})
