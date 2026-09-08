// Learn more https://docs.expo.dev/guides/monorepos
// Learn more https://docs.expo.io/guides/customizing-metro
/**
 * @type {import('expo/metro-config')}
 */
const { getDefaultConfig } = require('@expo/metro-config')
const { wrapWithReanimatedMetroConfig } = require('react-native-reanimated/metro-config')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot]
// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'packages/app/node_modules'),
]
// 3. Force Metro to resolve (sub)dependencies only from the `nodeModulesPaths`
config.resolver.disableHierarchicalLookup = true

// 3b. …except for a package's OWN nested node_modules. Yarn nests a dependency
// under its dependant when versions conflict — react-native-reanimated needs
// semver@7 while Babel keeps semver@6 hoisted at the workspace root — and with
// hierarchical lookup off Metro never looks inside
// `node_modules/<pkg>/node_modules`, so the bundle fails with
// "Unable to resolve module semver/functions/satisfies". When the default
// resolution fails, retry with the requiring package's nested node_modules
// (innermost first), which is exactly what Node's own algorithm would do.
function nestedNodeModulesFor(originModulePath) {
  const marker = `${path.sep}node_modules${path.sep}`
  const candidates = []
  let searchFrom = originModulePath.length
  for (;;) {
    const idx = originModulePath.lastIndexOf(marker, searchFrom)
    if (idx === -1) break
    const rest = originModulePath.slice(idx + marker.length).split(path.sep)
    const packageSegments = rest[0]?.startsWith('@') ? 2 : 1
    if (rest.length > packageSegments) {
      const packageRoot =
        originModulePath.slice(0, idx + marker.length) +
        rest.slice(0, packageSegments).join(path.sep)
      const nested = path.join(packageRoot, 'node_modules')
      if (fs.existsSync(nested)) candidates.push(nested)
    }
    searchFrom = idx - 1
  }
  return candidates
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform)
  } catch (error) {
    const nested = nestedNodeModulesFor(context.originModulePath).filter(
      (dir) => !context.nodeModulesPaths.includes(dir)
    )
    if (nested.length === 0) throw error
    return context.resolveRequest(
      { ...context, nodeModulesPaths: [...nested, ...context.nodeModulesPaths] },
      moduleName,
      platform
    )
  }
}

// Required for Tamagui v2 subpath imports (e.g., @tamagui/config/v5)
config.resolver.unstable_enablePackageExports = true
config.resolver.unstable_conditionNames = ['require', 'react-native', 'import']

config.transformer = { ...config.transformer, unstable_allowRequireContext: true }
config.transformer.minifierPath = require.resolve('metro-minify-terser')

module.exports = wrapWithReanimatedMetroConfig(config)
