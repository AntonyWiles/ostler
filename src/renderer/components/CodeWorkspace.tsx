import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import '../lib/monaco-setup'
import { useMonacoTheme } from '../ui/theme/ThemeProvider'
import { defineOstlerMonacoThemes } from '../lib/monaco-themes'
import { Button, EmptyState, IconButton, InlineAlert, Select, TextField } from '../ui'
import {
  ArrowLeft,
  ArrowRight,
  File,
  FileCode,
  Folder,
  House,
  Icon,
  Play,
  RefreshCw,
  SquareTerminal
} from '../ui/icons'
import type { CodeDirEntry } from '@shared/ostler-api'
import { useStickToBottom } from '../hooks/useStickToBottom'
import './CodeWorkspace.css'
import { t } from '@shared/i18n'

export interface CodeWorkspaceRoot {
  label: string
  path: string
}

interface CodeWorkspaceProps {
  projectId: string
  roots: CodeWorkspaceRoot[]
  selectedRoot: CodeWorkspaceRoot | undefined
  onSelectRoot: (root: CodeWorkspaceRoot) => void
  /** A file to open, scrolled to a line (Ask Ostler's file sources, N8.3a). */
  openAt?: { path: string; line: number | null }
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  xml: 'xml',
  toml: 'ini'
}

function languageForPath(relativePath: string): string {
  const ext = relativePath.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_BY_EXTENSION[ext] ?? 'plaintext'
}

/** Embedded file browser, Monaco editor, and streamed command runner for one workspace root. */
export function CodeWorkspace({
  projectId,
  roots,
  selectedRoot,
  onSelectRoot,
  openAt
}: CodeWorkspaceProps) {
  const monacoTheme = useMonacoTheme()
  const [currentPath, setCurrentPathState] = useState('')
  const [pathHistory, setPathHistory] = useState<string[]>([''])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [entries, setEntries] = useState<CodeDirEntry[]>([])
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [command, setCommand] = useState('')
  const [commandOutput, setCommandOutput] = useState('')
  const [running, setRunning] = useState(false)
  const runIdRef = useRef<string | null>(null)
  const {
    ref: outputRef,
    onScroll: onOutputScroll,
    scrollToBottom: followOutput
  } = useStickToBottom<HTMLPreElement>(commandOutput)

  const rootPath = selectedRoot?.path
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [pendingLine, setPendingLine] = useState<number | null>(null)
  const openAtPath = openAt?.path
  const openAtLine = openAt?.line ?? null

  useEffect(() => {
    setCurrentPathState('')
    setPathHistory([''])
    setHistoryIndex(0)
    setSelectedFile(null)
    setFileContent('')
    setOriginalContent('')
    setFileError(null)
  }, [rootPath])

  useEffect(() => {
    if (!rootPath) return
    let active = true
    setBrowseError(null)
    window.ostlerAPI.listCodeDirectory(projectId, rootPath, currentPath).then((result) => {
      if (!active) return
      if (result.ok) setEntries(result.value)
      else setBrowseError(result.error)
    })
    return () => {
      active = false
    }
  }, [projectId, rootPath, currentPath, refreshToken])

  /** Navigate to a path, pushing it onto history (truncating any forward entries). */
  const navigateTo = (path: string) => {
    if (path === currentPath) return
    setCurrentPathState(path)
    setPathHistory((prev) => [...prev.slice(0, historyIndex + 1), path])
    setHistoryIndex((prev) => prev + 1)
  }

  const goBack = () => {
    if (historyIndex === 0) return
    const nextIndex = historyIndex - 1
    setHistoryIndex(nextIndex)
    setCurrentPathState(pathHistory[nextIndex])
  }

  const goForward = () => {
    if (historyIndex >= pathHistory.length - 1) return
    const nextIndex = historyIndex + 1
    setHistoryIndex(nextIndex)
    setCurrentPathState(pathHistory[nextIndex])
  }

  const refresh = () => setRefreshToken((prev) => prev + 1)

  useEffect(
    () =>
      window.ostlerAPI.onCodeCommandOutput((event) => {
        if (event.runId !== runIdRef.current) return
        if (event.stream === 'exit') {
          setCommandOutput(
            (prev) => prev + t('projects:codeWorkspace.exitedCode', { exitCode: event.exitCode })
          )
          setRunning(false)
          runIdRef.current = null
        } else {
          setCommandOutput((prev) => prev + event.data)
        }
      }),
    []
  )

  const openFile = async (relativePath: string) => {
    if (!rootPath) return
    setFileError(null)
    const result = await window.ostlerAPI.readCodeFile(projectId, rootPath, relativePath)
    if (!result.ok) {
      setFileError(result.error)
      return
    }
    setSelectedFile(relativePath)
    setFileContent(result.value)
    setOriginalContent(result.value)
  }

  // A link that names a file opens it in its folder, at its line once the editor has it.
  useEffect(() => {
    if (!rootPath || !openAtPath) return
    const slash = openAtPath.lastIndexOf('/')
    setCurrentPathState(slash > 0 ? openAtPath.slice(0, slash) : '')
    setPendingLine(openAtLine)
    void openFile(openAtPath)
    // openFile reads only rootPath and projectId, which this already follows.
  }, [rootPath, openAtPath, openAtLine])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !editorReady || pendingLine === null || selectedFile !== openAtPath) return
    editor.revealLineInCenter(pendingLine)
    editor.setPosition({ lineNumber: pendingLine, column: 1 })
    setPendingLine(null)
  }, [editorReady, pendingLine, selectedFile, openAtPath, fileContent])

  const saveFile = async () => {
    if (!rootPath || !selectedFile) return
    setSaving(true)
    setFileError(null)
    try {
      const result = await window.ostlerAPI.writeCodeFile(
        projectId,
        rootPath,
        selectedFile,
        fileContent
      )
      if (!result.ok) {
        setFileError(result.error)
        return
      }
      setOriginalContent(fileContent)
    } finally {
      setSaving(false)
    }
  }

  const runCommand = async () => {
    if (!rootPath || !command.trim() || running) return
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    setRunning(true)
    followOutput()
    setCommandOutput((prev) => (prev ? prev + `\n$ ${command}\n` : `$ ${command}\n`))
    const result = await window.ostlerAPI.runCodeCommand(projectId, rootPath, runId, command)
    if (!result.ok) {
      setCommandOutput((prev) => prev + `${result.error}\n`)
      setRunning(false)
      runIdRef.current = null
    }
  }

  const cancelCommand = async () => {
    if (!runIdRef.current) return
    await window.ostlerAPI.cancelCodeCommand(runIdRef.current)
  }

  const dirty = fileContent !== originalContent

  const segments = currentPath.split('/').filter(Boolean)

  return (
    <div className="code-workspace">
      <div className="code-workspace__toolbar">
        <Select
          label={t('projects:codeWorkspace.codeWorkspaceRoot')}
          hideLabel
          size="sm"
          value={rootPath ?? ''}
          onChange={(event) => {
            const next = roots.find((r) => r.path === event.target.value)
            if (next) onSelectRoot(next)
          }}
          options={roots.map((root) => ({ value: root.path, label: root.label }))}
        />
        <IconButton
          size="sm"
          icon={ArrowLeft}
          label={t('projects:codeWorkspace.back')}
          onClick={goBack}
          disabled={historyIndex === 0}
        />
        <IconButton
          size="sm"
          icon={ArrowRight}
          label={t('projects:codeWorkspace.forward')}
          onClick={goForward}
          disabled={historyIndex >= pathHistory.length - 1}
        />
        <IconButton
          size="sm"
          icon={House}
          label={t('projects:codeWorkspace.goTopLevelDirectory')}
          onClick={() => navigateTo('')}
          disabled={!rootPath}
        />
        <IconButton
          size="sm"
          icon={RefreshCw}
          label={t('projects:codeWorkspace.refresh')}
          onClick={refresh}
          disabled={!rootPath}
        />
        <nav
          className="code-workspace__breadcrumb"
          aria-label={t('projects:codeWorkspace.folderPath')}
        >
          <button type="button" onClick={() => navigateTo('')} disabled={!currentPath}>
            {selectedRoot?.label ?? 'root'}
          </button>
          {segments.map((segment, index) => {
            const path = segments.slice(0, index + 1).join('/')
            return (
              <span key={path}>
                <span aria-hidden="true">/</span>
                <button
                  type="button"
                  onClick={() => navigateTo(path)}
                  aria-current={index === segments.length - 1 ? 'location' : undefined}
                >
                  {segment}
                </button>
              </span>
            )
          })}
        </nav>
      </div>

      {!rootPath ? (
        <EmptyState
          icon={Folder}
          title={t('projects:codeWorkspace.noFolderShow')}
          description={t('projects:codeWorkspace.filesShowsFolderLinked')}
        />
      ) : (
        <>
          <div className="code-workspace__body">
            <nav
              className="code-workspace__tree"
              aria-label={t('projects:codeWorkspace.workspaceFiles')}
            >
              {browseError && <InlineAlert tone="warning">{browseError}</InlineAlert>}
              <ul>
                {entries.map((entry) => (
                  <li key={entry.relativePath}>
                    <button
                      type="button"
                      className="code-workspace__entry"
                      aria-current={selectedFile === entry.relativePath ? 'true' : undefined}
                      onClick={() =>
                        entry.isDirectory
                          ? navigateTo(entry.relativePath)
                          : openFile(entry.relativePath)
                      }
                    >
                      <Icon
                        icon={entry.isDirectory ? Folder : codeLike(entry.name) ? FileCode : File}
                        className={entry.isDirectory ? 'code-workspace__folder-icon' : undefined}
                      />
                      <span>{entry.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {!entries.length && !browseError && (
                <p className="code-workspace__muted">
                  {t('projects:codeWorkspace.emptyDirectory')}
                </p>
              )}
            </nav>
            <section
              className="code-workspace__editor"
              aria-label={t('projects:codeWorkspace.editor')}
            >
              {selectedFile ? (
                <>
                  <header className="code-workspace__editor-header">
                    <span title={selectedFile}>
                      {selectedFile}
                      {dirty && (
                        <span className="code-workspace__dirty">
                          {t('projects:codeWorkspace.unsaved')}
                        </span>
                      )}
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!dirty || saving}
                      loading={saving}
                      onClick={() => void saveFile()}
                    >
                      {saving
                        ? t('projects:codeWorkspace.saving')
                        : t('projects:codeWorkspace.save')}
                    </Button>
                  </header>
                  {fileError && <InlineAlert tone="danger">{fileError}</InlineAlert>}
                  <div className="code-workspace__monaco">
                    <Editor
                      height="100%"
                      language={languageForPath(selectedFile)}
                      value={fileContent}
                      onChange={(value) => setFileContent(value ?? '')}
                      beforeMount={defineOstlerMonacoThemes}
                      onMount={(editor) => {
                        editorRef.current = editor
                        setEditorReady(true)
                      }}
                      theme={monacoTheme}
                      options={{
                        minimap: { enabled: true },
                        fontSize: 13,
                        automaticLayout: true
                      }}
                    />
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={FileCode}
                  title={t('projects:codeWorkspace.selectFileEdit')}
                  description={t('projects:codeWorkspace.chooseFileListLeft')}
                />
              )}
            </section>
          </div>

          <section
            className="code-workspace__runner"
            aria-label={t('projects:codeWorkspace.commandRunner')}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void runCommand()
              }}
            >
              <TextField
                label={t('projects:codeWorkspace.command')}
                hideLabel
                prefix={<Icon icon={SquareTerminal} />}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder={t('projects:codeWorkspace.runCommandIn', {
                  folder: selectedRoot?.label ?? ''
                })}
                disabled={running}
                className="code-workspace__command"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                icon={Play}
                disabled={running || !command.trim()}
              >
                {running ? t('projects:codeWorkspace.running') : t('projects:codeWorkspace.run')}
              </Button>
              {running && (
                <Button variant="ghost" size="sm" onClick={() => void cancelCommand()}>
                  {t('projects:codeWorkspace.cancel')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCommandOutput('')}
                disabled={!commandOutput}
              >
                {t('projects:codeWorkspace.clear')}
              </Button>
            </form>
            <pre ref={outputRef} onScroll={onOutputScroll} className="code-workspace__output">
              {commandOutput || t('projects:codeWorkspace.outputStreamsHereNot')}
            </pre>
          </section>
        </>
      )}
    </div>
  )
}

const CODE_EXTENSIONS = new Set(Object.keys(LANGUAGE_BY_EXTENSION).filter((ext) => ext !== 'md'))

function codeLike(name: string): boolean {
  return CODE_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() ?? '')
}
