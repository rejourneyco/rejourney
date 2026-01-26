import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.spec.ts'],
    exclude: ['node_modules', 'lib', 'android', 'ios'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: [
        'node_modules/**',
        'lib/**',
        'android/**',
        'ios/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        '**/types/**',
        '**/NativeRejourney.ts', // Native module interface - can't test without native runtime
      ],
    },
  },
  define: {
    __DEV__: true,
  },
});
