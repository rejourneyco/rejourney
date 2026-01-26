
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const API_URL = 'http://localhost:3000/api';
const API_KEY = 'test_key'; // Ensure this key exists or create it

async function run() {
    const sessionId = `verify_ts_${Date.now()}`;
    const payload = JSON.stringify({
        frames: [{ timestamp: 1678900000000 }] // Specific timestamp to verify
    });

    // Create gzipped payload
    const gzipped = zlib.gzipSync(payload);
    fs.writeFileSync('temp_frames.json.gz', gzipped);

    console.log(`Setting up session: ${sessionId}`);

    try {
        // 1. Presign (creates session lazily)
        const presignCmd = `curl -s -X POST "${API_URL}/ingest/presign" \
            -H "Content-Type: application/json" \
            -H "x-api-key: ${API_KEY}" \
            -d '{"sessionId": "${sessionId}", "contentType": "frames", "batchNumber": 1, "sizeBytes": ${gzipped.length}}'`;

        const presignRes = execSync(presignCmd).toString();
        const { presignedUrl, batchId } = JSON.parse(presignRes);

        if (!presignedUrl) throw new Error('No presigned URL returned');

        // 2. Upload to S3 (simulate client upload)
        // Use generic curl to upload content to the presigned URL
        // Note: For MinIO local, we might need to adjust hostname if strictly running from host
        // But presign now returns localhost-friendly URL if configured right.
        // We'll trust the URL returned for now.
        const uploadCmd = `curl -s -X PUT "${presignedUrl}" \
            -H "Content-Type: application/json" \
            --data-binary @temp_frames.json.gz`;
        execSync(uploadCmd);

        // 3. Complete Batch
        const completeCmd = `curl -s -X POST "${API_URL}/ingest/batch/complete" \
            -H "Content-Type: application/json" \
            -H "x-api-key: ${API_KEY}" \
            -d '{"batchId": "${batchId}", "actualSizeBytes": ${gzipped.length}, "frameCount": 1}'`;
        execSync(completeCmd);

        console.log('Upload complete. Checking DB...');

        // 4. Verify DB
        // Wait a moment for async processing if any (though batch complete is mostly sync for artifact creation)
        await new Promise(r => setTimeout(r, 1000));

        const artifact = await prisma.recordingArtifact.findFirst({
            where: { sessionId, kind: 'frames' },
        });

        if (!artifact) {
            console.error('❌ Artifact not found!');
        } else {
            console.log('Artifact found:', artifact);

            let failures = [];
            if (artifact.status !== 'ready') failures.push(`Status is ${artifact.status}, expected ready`);
            if (!artifact.readyAt) failures.push('readyAt is null');
            if (artifact.timestamp !== 1678900000000) failures.push(`Timestamp is ${artifact.timestamp}, expected 1678900000000`);

            if (failures.length > 0) {
                console.error('❌ Verification FAILED:', failures.join(', '));
            } else {
                console.log('✅ Verification PASSED!');
            }
        }

    } catch (e) {
        console.error('Error during verification:', e);
    } finally {
        // Cleanup
        if (fs.existsSync('temp_frames.json.gz')) fs.unlinkSync('temp_frames.json.gz');
        await prisma.session.deleteMany({ where: { id: sessionId } }); // Cleanup session
        await prisma.$disconnect();
    }
}

run();
