import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/__tests__/**/*.test.ts'],
        env: {
            DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/rejourney_test',
            JWT_SECRET: 'test_jwt_secret_value_for_unit_tests',
            INGEST_HMAC_SECRET: 'test_ingest_hmac_secret_value_for_unit_tests',
            S3_ACCESS_KEY: 'test',
            S3_SECRET_KEY: 'test',
            S3_ENDPOINT: 'http://localhost:9000',
            S3_REGION: 'us-east-1',
            REDIS_URL: 'redis://localhost:6379'
        },
        coverage: {
            reporter: ['text', 'html'],
        },
    },
});
