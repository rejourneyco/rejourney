import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
    eslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module',
            },
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                module: 'readonly',
                require: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            // TypeScript-specific rules
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'off',

            // General rules
            'no-unused-vars': 'off', // Use TypeScript's instead
            'no-undef': 'off', // TypeScript handles this
            'no-console': 'off', // Allow console in backend
            'prefer-const': 'warn',
            'no-var': 'error',
        },
    },
    {
        // MCP tools reach tenant data only through the scoped data layer they
        // are handed (docs/mcp-server-plan.md, section 6.2). They may not import
        // a database client, the schema, the query builder, storage, or the
        // data layer's implementation.
        files: ['src/mcp/tools/**/*.ts'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [
                    {
                        group: ['**/db/*', '**/db', 'drizzle-orm', 'drizzle-orm/*', 'pg', 'pg-*', '@electric-sql/*', '@aws-sdk/*', 'ioredis', '@clickhouse/*'],
                        message: 'MCP tools must not touch the database or storage. Use the McpScopedData passed in deps.',
                    },
                    {
                        group: ['**/data/scoped.js', '**/data/db.js', '**/artifacts/*', '**/demo/*', '**/routes/*'],
                        message: 'MCP tools must not import the data layer implementation, artifact readers, seed data or route files.',
                    },
                ],
            }],
        },
    },
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            '**/*.js',
            'drizzle/**',
        ],
    },
];
