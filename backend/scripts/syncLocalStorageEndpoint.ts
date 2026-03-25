process.env.STORAGE_SYNC_LABEL = process.env.STORAGE_SYNC_LABEL || 'local-k8s';
await import('./syncStorageEndpoint.ts');
