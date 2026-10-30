const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

// The phone app reuses files from the repository root: the sync engine and schema under
// `electron/services/` and the shared code under `src/shared/`. Only those two folders are
// watched; watching the whole repository makes Metro crawl its node_modules and worktrees.
const repo = path.resolve(__dirname, '..')
const config = getDefaultConfig(__dirname)

config.watchFolders = [path.join(repo, 'electron'), path.join(repo, 'src', 'shared')]
// Do not set `disableHierarchicalLookup`: it breaks Expo itself (docs/plans/mobile/reports/01b).
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')]

const enginePlatform = path.join(repo, 'electron', 'services', 'sync', 'platform')
const phonePlatform = path.join(__dirname, 'src', 'platform.ts')

const aliases = {
  'node:crypto': 'react-native-quick-crypto',
  crypto: 'react-native-quick-crypto',
  'node:buffer': path.join(__dirname, 'shims', 'buffer.ts'),
  'node:zlib': path.join(__dirname, 'shims', 'zlib.ts'),
  uuid: path.join(__dirname, 'shims', 'uuid.ts')
}
const stubbed = []

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // The engine reaches Node and Electron only through `./platform`; the phone swaps it.
  if (moduleName.startsWith('.') && context.originModulePath) {
    const target = path.resolve(path.dirname(context.originModulePath), moduleName)
    if (target === enginePlatform || target === `${enginePlatform}.ts`) {
      return { type: 'sourceFile', filePath: phonePlatform }
    }
  }
  if (aliases[moduleName]) return context.resolveRequest(context, aliases[moduleName], platform)
  if (moduleName.startsWith('@shared/')) {
    return context.resolveRequest(
      context,
      path.join(repo, 'src', 'shared', moduleName.slice('@shared/'.length)),
      platform
    )
  }
  if (moduleName.startsWith('node:') || moduleName === 'electron') {
    if (!stubbed.includes(moduleName)) {
      stubbed.push(moduleName)
      console.warn(`[metro] stubbed ${moduleName} (imported from ${context.originModulePath})`)
    }
    return { type: 'empty' }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
