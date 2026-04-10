const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const packageJson = require('./package.json');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const rejourneyPackageRoot = path.resolve(workspaceRoot, 'packages/react-native');
const rejourneyDependency = packageJson.dependencies?.['@rejourneyco/react-native'] ?? '';
const useLocalRejourneyPackage = rejourneyDependency.startsWith('file:');

const config = getDefaultConfig(projectRoot);

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (useLocalRejourneyPackage) {
  // When the app points at the in-repo SDK, resolve Metro directly to source so
  // local SDK edits are reflected without republishing.
  config.watchFolders = [...(config.watchFolders ?? []), rejourneyPackageRoot];

  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ];

  config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    '@rejourneyco/react-native': rejourneyPackageRoot,
    'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
    'react': path.resolve(projectRoot, 'node_modules/react'),
  };

  const existingBlockList = Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : [];

  // Block duplicate react-native/react from the workspace root while the SDK is
  // sourced locally to keep Metro on a single React/React Native instance.
  config.resolver.blockList = [
    ...existingBlockList,
    new RegExp(`${escapeForRegex(path.resolve(workspaceRoot, 'node_modules/react-native'))}/.*`),
    new RegExp(`${escapeForRegex(path.resolve(workspaceRoot, 'node_modules/react'))}/.*`),
  ];
}

module.exports = config;
