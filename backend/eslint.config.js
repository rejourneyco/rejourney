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
        ignores: [
            'dist/**',
            'node_modules/**',
            '**/*.js',
            'drizzle/**',
        ],
    },
];
