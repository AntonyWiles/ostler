import { describe, it, expect } from 'vitest'
import { getExtension, classifyFile } from '../../electron/services/file-classifier'

describe('file-classifier.ts', () => {
  describe('getExtension', () => {
    it('extracts lowercased extension with leading dot', () => {
      expect(getExtension('src/index.TS')).toBe('.ts')
      expect(getExtension('styles/app.SCSS')).toBe('.scss')
      expect(getExtension('image.PNG')).toBe('.png')
    })

    it('returns empty string if no extension exists', () => {
      expect(getExtension('Dockerfile')).toBe('')
      expect(getExtension('LICENSE')).toBe('')
    })
  })

  describe('classifyFile', () => {
    it('classifies dependency folders as dependency (priority 1)', () => {
      expect(classifyFile('node_modules/react/index.js')).toBe('dependency')
      expect(classifyFile('__pycache__/module.pyc')).toBe('dependency')
      expect(classifyFile('.venv/lib/python3.10/site.py')).toBe('dependency')
      expect(classifyFile('venv/bin/activate')).toBe('dependency')
    })

    it('classifies build output folders as build (priority 2)', () => {
      expect(classifyFile('out/main/index.js')).toBe('build')
      expect(classifyFile('dist/bundle.js')).toBe('build')
      expect(classifyFile('build/static/js/main.js')).toBe('build')
      expect(classifyFile('.next/static/chunks/app.js')).toBe('build')
      expect(classifyFile('target/debug/app.exe')).toBe('build')
    })

    it('classifies test files and test dirs as test (priority 3)', () => {
      expect(classifyFile('tests/unit/app.test.ts')).toBe('test')
      expect(classifyFile('src/components/Button.spec.tsx')).toBe('test')
      expect(classifyFile('src/__tests__/utils.ts')).toBe('test')
    })

    it('classifies source files based on extension', () => {
      expect(classifyFile('src/index.ts')).toBe('source')
      expect(classifyFile('src/App.tsx')).toBe('source')
      expect(classifyFile('src/server.js')).toBe('source')
      expect(classifyFile('lib/core.py')).toBe('source')
      expect(classifyFile('src/main.rs')).toBe('source')
      expect(classifyFile('src/main.go')).toBe('source')
      expect(classifyFile('src/App.java')).toBe('source')
    })

    it('classifies styles, markup, configs, and docs correctly', () => {
      expect(classifyFile('src/styles.css')).toBe('style')
      expect(classifyFile('src/theme.scss')).toBe('style')
      expect(classifyFile('public/index.html')).toBe('markup')
      expect(classifyFile('src/logo.svg')).toBe('markup')
      expect(classifyFile('package.json')).toBe('config')
      expect(classifyFile('tsconfig.json')).toBe('config')
      expect(classifyFile('.env')).toBe('config')
      expect(classifyFile('README.md')).toBe('documentation')
      expect(classifyFile('docs/guide.txt')).toBe('documentation')
    })

    it('classifies media files', () => {
      expect(classifyFile('assets/logo.png')).toBe('media')
      expect(classifyFile('assets/banner.jpg')).toBe('media')
      expect(classifyFile('assets/icon.ico')).toBe('media')
      expect(classifyFile('assets/sound.mp3')).toBe('media')
    })

    it('classifies unknown files as other', () => {
      expect(classifyFile('custom.xyz123')).toBe('other')
      expect(classifyFile('LICENSE')).toBe('other')
    })
  })
})
