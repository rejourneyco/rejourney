const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// Root of the monorepo (parent of examples)
const workspaceRoot = path.resolve(__dirname, '../..');
// Root of the rejourney package
const rejourneyPackageRoot = path.resolve(workspaceRoot, 'packages/react-native');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
    // Watch the rejourney package source for changes
    watchFolders: [rejourneyPackageRoot],

    resolver: {
        // Ensure Metro can find node_modules in both locations
        nodeModulesPaths: [
            path.resolve(__dirname, 'node_modules'),
            path.resolve(workspaceRoot, 'node_modules'),
        ],
        // Resolve rejourney package to the correct location
        extraNodeModules: {
            'rejourney': rejourneyPackageRoot,
        },
        // Block duplicate react-native packages from being bundled
        blockList: [
            // Exclude node_modules inside the workspace except for rejourney itself
            new RegExp(`${workspaceRoot}/node_modules/react-native/.*`),
            new RegExp(`${workspaceRoot}/node_modules/react/.*`),
        ],
    },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

