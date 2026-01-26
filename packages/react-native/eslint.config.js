import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
    eslint.configs.recommended,
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module',
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                console: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                module: 'readonly',
                require: 'readonly',
                process: 'readonly',
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
            'no-console': 'off', // Allow console in SDK
            'prefer-const': 'warn',
            'no-var': 'error',
        },
    },
    {
        ignores: [
            'lib/**',
            'node_modules/**',
            'android/**',
            'ios/**',
            '**/*.js',
            '**/*.mjs',
            '*.config.js',
        ],
    },
];
