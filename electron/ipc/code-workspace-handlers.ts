import {
  CommandRunner,
  listDirectory,
  readWorkspaceFile,
  writeWorkspaceFile
} from '../services/code-workspace-service'
import { handleApi } from './handle-ipc'

interface CommandOutput {
  runId: string
  stream: 'stdout' | 'stderr' | 'exit'
  data: string
  exitCode?: number
}

export interface CodeWorkspaceHandlerDependencies {
  assertWorkspaceRoot(projectId: string, rootPath: string): void
  sendCommandOutput(output: CommandOutput): void
  notifyCommandFailure(projectId: string, command: string, exitCode: number): void
}

/** Registers Code tab filesystem and command handlers and owns their run state. */
export function registerCodeWorkspaceHandlers({
  assertWorkspaceRoot,
  sendCommandOutput,
  notifyCommandFailure
}: CodeWorkspaceHandlerDependencies): void {
  const commandRunner = new CommandRunner()
  const cancelledRuns = new Set<string>()

  handleApi(
    'listCodeDirectory',
    async (_event, projectId: string, rootPath: string, relativePath: string) => {
      assertWorkspaceRoot(projectId, rootPath)
      return listDirectory(rootPath, relativePath)
    }
  )

  handleApi(
    'readCodeFile',
    async (_event, projectId: string, rootPath: string, relativePath: string) => {
      assertWorkspaceRoot(projectId, rootPath)
      return readWorkspaceFile(rootPath, relativePath)
    }
  )

  handleApi(
    'writeCodeFile',
    async (_event, projectId: string, rootPath: string, relativePath: string, content: string) => {
      assertWorkspaceRoot(projectId, rootPath)
      writeWorkspaceFile(rootPath, relativePath, content)
    }
  )

  handleApi(
    'runCodeCommand',
    async (_event, projectId: string, rootPath: string, runId: string, command: string) => {
      assertWorkspaceRoot(projectId, rootPath)
      commandRunner.run(
        runId,
        rootPath,
        command,
        (stream, data) => sendCommandOutput({ runId, stream, data }),
        (exitCode) => {
          sendCommandOutput({ runId, stream: 'exit', data: '', exitCode })
          if (exitCode !== 0 && !cancelledRuns.delete(runId)) {
            notifyCommandFailure(projectId, command, exitCode)
          }
        }
      )
    }
  )

  handleApi('cancelCodeCommand', (_event, runId: string) => {
    cancelledRuns.add(runId)
    commandRunner.cancel(runId)
  })
}
