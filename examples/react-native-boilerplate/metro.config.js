const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const rejourneyPackageRoot = path.resolve(workspaceRoot, 'packages/react-native');

const config = getDefaultConfig(projectRoot);

// Watch the rejourney package source for changes
config.watchFolders = [rejourneyPackageRoot];

// Resolve node_modules from both directories
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
];

// Resolve rejourney package to the correct location
config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    'rejourney': rejourneyPackageRoot,
    'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
    'react': path.resolve(projectRoot, 'node_modules/react'),
};

// Block duplicate react-native/react from workspace root
config.resolver.blockList = [
    new RegExp(path.resolve(workspaceRoot, 'node_modules/react-native') + '/.*'),
    new RegExp(path.resolve(workspaceRoot, 'node_modules/react') + '/.*'),
];

module.exports = config;
