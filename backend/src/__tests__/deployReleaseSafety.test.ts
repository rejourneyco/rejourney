import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(TEST_DIR, '../../..');
const deployScript = readFileSync(resolve(ROOT_DIR, 'scripts/k8s/deploy-release.sh'), 'utf8');
const apiManifest = readFileSync(resolve(ROOT_DIR, 'k8s/api.yaml'), 'utf8');
const workerManifest = readFileSync(resolve(ROOT_DIR, 'k8s/workers.yaml'), 'utf8');
const redisValues = readFileSync(resolve(ROOT_DIR, 'k8s/helm/redis-values.yaml'), 'utf8');

function deploymentDocument(source: string, name: string): string {
    const document = source
        .split(/^---\s*$/m)
        .find((candidate) => candidate.includes('kind: Deployment') && candidate.includes(`name: ${name}`));
    if (!document) throw new Error(`Deployment ${name} not found`);
    return document;
}

function apiImageDeploymentNames(source: string): string[] {
    return source
        .split(/^---\s*$/m)
        .filter(
            (document) =>
                document.includes('kind: Deployment') &&
                document.includes('ghcr.io/rejourneyco/rejourney/api:'),
        )
        .map((document) => {
            const name = document.match(/^\s{2}name:\s+([^\s]+)$/m)?.[1];
            if (!name) throw new Error('API-image Deployment is missing metadata.name');
            return name;
        });
}

describe('production release safety', () => {
    it('reconciles Redis with the installed pinned chart and verifies AOF-only persistence', () => {
        expect(deployScript).toContain('REDIS_CHART_VERSION="25.3.11"');
        expect(deployScript).toContain('helm upgrade redis bitnami/redis');
        expect(deployScript).toContain('--reset-values');
        expect(deployScript).toContain('--atomic');
        expect(deployScript).toContain('--dry-run=server');
        expect(deployScript).toContain('verify_redis_persistence_config');
        expect(deployScript).toContain("'aof_last_write_status=ok'");
        expect(deployScript).toContain("'aof_last_bgrewrite_status=ok'");
        expect(deployScript).toContain("required='master_link_status=up'");
        expect(deployScript).toContain('required="connected_slaves=$((desired - 1))"');
        expect(deployScript).toContain('deadline=$(( $(date +%s) + 180 ))');
        expect(deployScript.lastIndexOf('\n  apply_redis_helm_values\n')).toBeLessThan(
            deployScript.lastIndexOf('\n  apply_db_setup_job\n'),
        );

        const digests = [
            'sha256:08863c2c3f4e051fb6139b38fa223e9c13be5033326a59bead182860d899bf98',
            'sha256:ae75dd69c192a632bdeb21baa6721080be5b12347e52add922036398b47631da',
            'sha256:d768e44e2e0aff5bcb2bce39609e4877b7ac2cf000670dbaea794da2e35e0e7a',
        ];
        for (const digest of digests) {
            expect(redisValues).toContain(`digest: ${digest}`);
            expect(deployScript).toContain(`@${digest}`);
        }
    });

    it('waits for every API-image worker added to the release', () => {
        const names = [...apiImageDeploymentNames(apiManifest), ...apiImageDeploymentNames(workerManifest)];
        expect(names).toContain('google-ads-conversion-worker');
        for (const name of names) {
            expect(deployScript).toContain(`wait_for_deployment ${name}`);
        }
        expect(deployScript).toContain('wait_for_deployment pgweb');
        expect(deployScript.indexOf('wait_for_deployment google-ads-conversion-worker')).toBeLessThan(
            deployScript.indexOf('Release applied successfully'),
        );
    });

    it('leaves replica ownership to HPAs without a one-time scale down', () => {
        const hpaDeployments = [
            [apiManifest, 'api-ingest'],
            [apiManifest, 'api-dashboard'],
            [apiManifest, 'ingest-upload'],
            [workerManifest, 'ingest-worker'],
            [workerManifest, 'replay-worker'],
        ] as const;

        for (const [manifest, name] of hpaDeployments) {
            expect(deploymentDocument(manifest, name)).not.toMatch(/^\s{2}replicas:/m);
        }
        expect(deployScript).toContain('release_hpa_replica_ownership');
        expect(deployScript.lastIndexOf('\n  release_hpa_replica_ownership\n')).toBeLessThan(
            deployScript.lastIndexOf('kubectl apply -f "${RENDER_DIR}/"'),
        );
    });
});
