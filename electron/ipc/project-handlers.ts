import { app, dialog, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BRAND } from '@shared/brand'
import { assertValidDesktopUpdate } from '@shared/ostler-api'
import type {
  EventQuery,
  ExportOptions,
  NewProjectRequest,
  RendererConfigUpdate,
  SaveProjectTemplateInput,
  DemoProjectsStatus,
  RendererProjectUpdate,
  WatchedProject
} from '@shared/ostler-api'
import type { ConfigStore } from '../config-store'
import type { EventDatabase } from '../services/event-database'
import type { FileWatcherService } from '../services/file-watcher'
import type { GitReaderService } from '../services/git-reader'
import type { HarnessHttpServer } from '../services/harness-http-server'
import type { AutomationHttpServer } from '../services/automation-http-server'
import {
  assertAgentsCanTurnOff,
  showAgentColumnsWhereNeeded,
  syncHttpServers
} from '../services/agents-switch'
import type { HarnessService } from '../services/harness-service'
import type { ProjectRemovalService } from '../services/project-removal-service'
import type { ProjectScaffoldService } from '../services/project-scaffold-service'
import type { ProjectPackageService } from '../services/project-package-service'
import type { ProjectPackage } from '@shared/project-package'
import type { ProjectRuntimeController } from '../services/project-runtime-controller'
import { ProjectFolderService } from '../services/project-folder-service'
import { handleApi } from './handle-ipc'
import { safeFileName } from '../app/file-names'
import { projectFolder } from '@shared/project-folder'
import { isDemoProjectName } from '@shared/templates/template-text'
import { applyNativeTheme, assertValidAppearanceUpdate } from '../app/appearance'
import {
  fromRendererConfigUpdate,
  fromRendererProjectUpdate,
  toRendererConfig,
  toRendererProject
} from '@shared/renderer-config'
import { t } from '@shared/i18n'

export interface ProjectHandlerDependencies {
  configStore: ConfigStore
  database: EventDatabase
  fileWatcher: FileWatcherService
  gitReader: GitReaderService
  harnessService: HarnessService
  harnessHttpServer: HarnessHttpServer
  automationHttpServer: AutomationHttpServer
  projectRemovalService: ProjectRemovalService
  projectScaffoldService: ProjectScaffoldService
  projectPackageService: ProjectPackageService
  /** Shows a project's hidden Ready and In review (R2.4); returns the statuses it showed. */
  showAgentColumns(projectId: string): readonly string[]
  runtimeController: ProjectRuntimeController
  getMainWindow(): BrowserWindow | null
  getProject(projectId: string): WatchedProject
  validateProjectRelativePath(project: WatchedProject, relativePath: string): string
}

/** Registers projects, watcher, event, Git, and runtime-configuration IPC. */
export function registerProjectHandlers(dependencies: ProjectHandlerDependencies): void {
  const {
    configStore,
    database,
    fileWatcher,
    gitReader,
    harnessService,
    harnessHttpServer,
    automationHttpServer,
    projectRemovalService,
    projectScaffoldService,
    projectPackageService,
    runtimeController,
    getMainWindow,
    getProject,
    validateProjectRelativePath
  } = dependencies

  handleApi('getProjects', () => configStore.getProjects().map(toRendererProject))

  handleApi('getNewProjectDefaults', () => projectScaffoldService.getDefaults())
  handleApi('checkNewProjectLocation', (_event, parentPath: string, folderName: string) =>
    projectScaffoldService.checkLocation(parentPath, folderName)
  )
  handleApi('createProject', async (_event, request: NewProjectRequest) => {
    const templateId = request?.templateId
    const result =
      typeof templateId === 'string' && templateId
        ? await projectPackageService.createProjectFromTemplate(templateId, {
            name: request.name,
            color: request.color,
            icon: request.icon,
            notes: request.notes,
            tags: request.tags,
            folder: request.folder,
            stage: request.stage
          })
        : await projectScaffoldService.createProject(request)
    runtimeController.start(result.project)
    return { ...result, project: toRendererProject(result.project) }
  })

  // ─── Templates (P5.8) ──────────────────────────────────────────────────────
  handleApi('listProjectTemplates', () => projectPackageService.listTemplates())
  handleApi(
    'saveProjectAsTemplate',
    (_event, projectId: string, input: SaveProjectTemplateInput) => {
      getProject(projectId)
      return projectPackageService.saveProjectAsTemplate(projectId, input)
    }
  )
  handleApi('renameProjectTemplate', (_event, templateId: string, name: string) =>
    projectPackageService.renameTemplate(templateId, name)
  )
  handleApi('deleteProjectTemplate', (_event, templateId: string) =>
    projectPackageService.deleteTemplate(templateId)
  )
  handleApi('restoreProjectTemplate', (_event, templateId: string, pkg: ProjectPackage) =>
    projectPackageService.restoreTemplate(templateId, pkg)
  )
  handleApi('exportProjectTemplateFile', async (_event, templateId: string) => {
    const { name, text } = projectPackageService.templateFileText(templateId)
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('Main window is not available')
    // A file the person names, outside every project: never a watched folder's.
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: t('errors:projectHandlers.exportTemplate', { name }),
      buttonLabel: 'Export',
      defaultPath: join(app.getPath('documents'), `${safeFileName(name)}.json`),
      filters: [{ name: `${BRAND.name} template`, extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (choice.canceled || !choice.filePath) return null
    writeFileSync(choice.filePath, text, 'utf8')
    return choice.filePath
  })

  const projectFolders = new ProjectFolderService({
    getProject: (projectId) => {
      const project = configStore.getProjects().find((item) => item.id === projectId)
      if (!project) throw new Error(t('errors:projectHandlers.projectNotFound'))
      return project
    },
    validateProjectFolder: (folderPath, projectId) =>
      configStore.validateProjectFolder(folderPath, projectId),
    setProjectFolder: (projectId, folder) => configStore.setProjectFolder(projectId, folder),
    harness: harnessService,
    runtime: runtimeController
  })
  handleApi('linkProjectFolder', (_event, id: string, folderPath: string) => {
    const linked = projectFolders.link(id, folderPath)
    showAgentColumnsWhereNeeded(configStore.get(), dependencies.showAgentColumns, id)
    return toRendererProject(linked)
  })
  handleApi('unlinkProjectFolder', (_event, id: string) =>
    toRendererProject(projectFolders.unlink(id))
  )

  handleApi('getProjectRemovalInventory', async (_event, id: string) => {
    return await projectRemovalService.buildInventory(getProject(id))
  })
  handleApi('archiveProjectData', async (_event, id: string) => {
    const project = getProject(id)
    if (projectFolder(project) !== null) return await projectRemovalService.writeArchive(project)
    // No folder of its own: the human picks where the archive goes.
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('Main window is not available')
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: t('errors:projectHandlers.chooseWhereSaveArchive', { projectName: project.name }),
      buttonLabel: t('errors:projectHandlers.saveArchiveHere'),
      defaultPath: join(
        app.getPath('documents'),
        `${BRAND.name} archives`,
        safeFileName(project.name)
      ),
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (choice.canceled || !choice.filePath) return null
    return await projectRemovalService.writeArchive(project, choice.filePath)
  })
  handleApi('purgeProjectData', async (_event, id: string) => {
    const project = getProject(id)
    runtimeController.stop(id)
    const purge = await projectRemovalService.purge(project)
    configStore.removeProject(id)
    return purge
  })
  // The demos go together, with no backup: they come back from their packages.
  handleApi('getDemoProjects', (): DemoProjectsStatus => {
    const demos = configStore.getProjects().filter((project) => project.demo)
    const added = projectRemovalService.addedSinceMade(demos)
    return {
      projects: demos.map((project) => ({
        id: project.id,
        name: project.name,
        kind: project.demo!,
        enabled: project.enabled
      })),
      ...added,
      untouched:
        demos.every((project) => isDemoProjectName(project.demo!, project.name)) &&
        !projectRemovalService.editedSinceMade(demos)
    }
  })
  handleApi('removeDemoProjects', async () => {
    const demos = configStore.getProjects().filter((project) => project.demo)
    for (const project of demos) {
      runtimeController.stop(project.id)
      await projectRemovalService.purge(project)
      configStore.removeProject(project.id)
    }
    return demos.length
  })
  handleApi('removeProject', async (_event, id: string) => {
    const project = configStore.getProjects().find((item) => item.id === id)
    runtimeController.stop(id)
    const retainedBranches = project ? await harnessService.releaseProjectCopies(project) : []
    configStore.removeProject(id)
    return { retainedBranches }
  })

  handleApi('updateProject', (_event, id: string, updates: RendererProjectUpdate) => {
    const previous = configStore.getProjects().find((item) => item.id === id)
    if (!previous) throw new Error(t('errors:projectHandlers.projectNotFound'))
    const project = configStore.updateProject(id, fromRendererProjectUpdate(updates))
    if (previous.enabled !== project.enabled) {
      if (project.enabled) runtimeController.start(project)
      else runtimeController.stop(project.id)
    }
    return toRendererProject(project)
  })

  // Only the order changes; ids are checked against the registered projects.
  handleApi('reorderProjects', (_event, orderedIds: unknown) => {
    if (!Array.isArray(orderedIds)) throw new Error('Project order must be a list of project ids')
    return configStore.reorderProjects(orderedIds as string[]).map(toRendererProject)
  })

  // Areas (N5.1): the whole list in one save, checked by the config store.
  handleApi('getAreas', () => configStore.getAreas())
  handleApi('saveAreas', (_event, areas: unknown, assignments: unknown) =>
    configStore.saveAreas(areas, (assignments ?? {}) as Record<string, string | null>)
  )

  handleApi('browseForFolder', async (_event, title?: string) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('Main window is not available')
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title:
        typeof title === 'string' && title.trim()
          ? title.trim()
          : t('errors:projectHandlers.chooseProjectFolder')
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handleApi('getWatcherStatus', () => fileWatcher.getStatus())
  handleApi('pauseWatcher', (_event, projectId: string) => {
    getProject(projectId)
    fileWatcher.pauseProject(projectId)
  })
  handleApi('resumeWatcher', (_event, projectId: string) => {
    const project = getProject(projectId)
    const config = configStore.get()
    fileWatcher.resumeProject(
      projectId,
      project,
      config.watcher.ignorePatterns,
      config.watcher.debounceMs
    )
  })

  handleApi('getRecentEvents', (_event, options: EventQuery) => {
    if (options.projectId) getProject(options.projectId)
    const enabledProjectIds = new Set(
      configStore
        .getProjects()
        .filter((project) => project.enabled)
        .map((project) => project.id)
    )
    return database
      .getRecentEvents(options)
      .filter((event) => enabledProjectIds.has(event.projectId))
  })

  handleApi('getEventStats', (_event, projectId: string, windowMs: number) => {
    getProject(projectId)
    return database.getEventStats(projectId, windowMs)
  })

  handleApi('exportEvents', async (_event, options: ExportOptions) => {
    if (options.projectId) getProject(options.projectId)
    const enabledProjectIds = new Set(
      configStore
        .getProjects()
        .filter((project) => project.enabled)
        .map((project) => project.id)
    )
    const events = database
      .getRecentEvents({
        projectId: options.projectId,
        since: options.since,
        until: options.until,
        limit: 100000
      })
      .filter((event) => enabledProjectIds.has(event.projectId))
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('Main window is not available')
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: t('errors:projectHandlers.exportEvents'),
      defaultPath: `ostler-events-${Date.now()}.${options.format}`,
      filters: [
        options.format === 'json'
          ? { name: 'JSON', extensions: ['json'] }
          : { name: 'CSV', extensions: ['csv'] }
      ]
    })
    if (saveResult.canceled || !saveResult.filePath) return ''
    if (options.format === 'json') {
      writeFileSync(saveResult.filePath, JSON.stringify(events, null, 2))
    } else {
      const header = 'id,projectId,timestamp,type,relativePath,extension,sizeBytes,category\n'
      const rows = events
        .map(
          (event) =>
            `${event.id},${event.projectId},${event.timestamp},${event.type},"${event.relativePath}",${event.extension},${event.sizeBytes ?? ''},${event.category}`
        )
        .join('\n')
      writeFileSync(saveResult.filePath, header + rows)
    }
    return saveResult.filePath
  })

  handleApi('getGitState', async (_event, projectId: string) => {
    const config = configStore.get()
    const project = getProject(projectId)
    return gitReader.getState(projectId, projectFolder(project), config.git.maxCommitsToFetch)
  })
  handleApi('getGitLog', (_event, projectId: string, limit: number) => {
    getProject(projectId)
    return gitReader.getLog(projectId, limit)
  })
  handleApi('getGitFileDiff', (_event, projectId: string, commitHash: string, filePath: string) => {
    const project = getProject(projectId)
    return gitReader.getFileDiff(
      projectId,
      projectFolder(project),
      commitHash,
      validateProjectRelativePath(project, filePath)
    )
  })
  handleApi('getGitBranchGraph', (_event, projectId: string, maxCount: number) => {
    const project = getProject(projectId)
    return gitReader.getBranchGraph(projectId, projectFolder(project), maxCount)
  })

  // The renderer never sees the AI key or a project token (renderer-config.ts).
  handleApi('getConfig', () => toRendererConfig(configStore.get()))
  handleApi('clearAiApiKey', () => toRendererConfig(configStore.update({ ai: { apiKey: '' } })))
  handleApi('updateConfig', (_event, rendererUpdates: RendererConfigUpdate) => {
    const updates = fromRendererConfigUpdate(rendererUpdates)
    assertValidAppearanceUpdate(updates.ui)
    const previous = configStore.get()
    assertValidDesktopUpdate(updates.desktop, previous.desktop)
    if (updates.harness?.enabled === false && previous.harness.enabled) {
      assertAgentsCanTurnOff(previous.projects, (project) => harnessService.getState(project))
    }
    const config = configStore.update(updates)
    if (!previous.harness.enabled && config.harness.enabled)
      showAgentColumnsWhereNeeded(config, dependencies.showAgentColumns)
    if (updates.ui) applyNativeTheme(config.ui)
    runtimeController.reconfigure(previous, config)
    syncHttpServers(previous, config, {
      harness: harnessHttpServer,
      automation: automationHttpServer
    })
    return toRendererConfig(config)
  })
}
