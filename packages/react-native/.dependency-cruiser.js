/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'not-to-unlisted-dependency',
            severity: 'error',
            comment:
                'This module depends on something that is not listed in the package.json. ' +
                'Add it to the dependencies (or peerDependencies) section of the package.json to fix this.',
            from: { path: '^src' },
            to: {
                dependencyTypesNot: [
                    'npm',
                    'npm-dev',
                    'npm-peer',
                    'npm-optional',
                    'local',
                    'core'
                ],
                pathNot: [
                    // 'promise' is always available at runtime — it's bundled with React Native
                    'promise/setimmediate/rejection-tracking'
                ]
            }
        }
    ],
    options: {
        doNotFollow: {
            path: 'node_modules'
        },
        moduleSystems: ['cjs', 'es6'],
        tsConfig: {
            fileName: 'tsconfig.json'
        },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default']
        }
    }
};
