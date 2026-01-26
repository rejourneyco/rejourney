
import path from 'path';
import dotenv from 'dotenv';
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

// Load env from project root
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const prisma = new PrismaClient();
const projectId = '96fb926c-f933-43ab-a557-173ecf4cb7ad';
const plainKey = 'test_key';
const hashedKey = createHash('sha256').update(plainKey).digest('hex');

async function main() {
    // Check if key exists
    const existing = await prisma.apiKey.findFirst({
        where: { hashedKey }
    });

    if (existing) {
        console.log('Test key already exists');
        return;
    }

    await prisma.apiKey.create({
        data: {
            projectId,
            hashedKey,
            maskedKey: 'test_..._key',
            name: 'Test Key for Debug',
            scopes: ['ingest'],
        }
    });
    console.log('Created API key: test_key');
}

main().catch(console.error).finally(() => prisma.$disconnect());
