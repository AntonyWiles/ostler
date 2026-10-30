import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import type { Plugin, PluginOption } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'
import { BRAND } from './src/shared/brand'
import { APP_LANGUAGE } from './src/shared/app-language'

/**
 * Fills index.html's `%BRAND_FULL_NAME%` from the brand module, the one source
 * of the name, and `%APP_LANGUAGE%` from the app language (P9.2).
 */
function brandHtml(): Plugin {
  return {
    name: 'ostler-brand-html',
    transformIndexHtml: (html) =>
      html
        .replaceAll('%BRAND_FULL_NAME%', BRAND.fullName)
        .replaceAll('%APP_LANGUAGE%', APP_LANGUAGE)
  }
}

/**
 * `OSTLER_BUNDLE_REPORT=1 npm run build` (or `npm run build:analyze`) writes
 * the renderer bundle's treemap to `out/bundle-report.html` (P9.1). Off in a
 * normal build.
 */
function bundleReport(): PluginOption[] {
  if (process.env['OSTLER_BUNDLE_REPORT'] !== '1') return []
  return [
    visualizer({
      filename: resolve('out/bundle-report.html'),
      gzipSize: true,
      template: 'treemap'
    })
  ]
}

export default defineConfig({
  main: {
    // react-markdown and rehype-sanitize are ESM only: bundled into the CJS
    // main build for the shareable report's Markdown (R4.1).
    plugins: [externalizeDepsPlugin({ exclude: ['react-markdown', 'rehype-sanitize'] })],
    build: {
      lib: {
        entry: resolve('electron/main.ts')
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('electron/preload.ts')
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.js',
          format: 'cjs'
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    root: '.',
    publicDir: resolve('node_modules/monaco-editor/min'),
    build: {
      rollupOptions: {
        input: resolve('index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), brandHtml(), ...bundleReport()]
  }
})
