
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Load env from project root
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const prisma = new PrismaClient();

async function main() {
    const sessionId = process.argv[2];
    if (!sessionId) {
        console.error('Please provide a session ID');
        process.exit(1);
    }

    console.log(`Looking up session: ${sessionId}`);

    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            project: true,
        },
    });

    if (!session) {
        console.log('❌ Session NOT FOUND in database');

        console.log('Listing recent sessions:');
        const recent = await prisma.session.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' }
        });
        console.log(recent);
    } else {
        console.log('✅ Session FOUND');
        console.log({
            id: session.id,
            projectId: session.projectId,
            status: session.status,
            createdAt: session.createdAt,
            projectRecordingEnabled: session.project.recordingEnabled,
        });
    }

    await prisma.$disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
