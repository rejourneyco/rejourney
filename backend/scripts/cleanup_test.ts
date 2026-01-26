
import path from 'path';
import dotenv from 'dotenv';
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const prisma = new PrismaClient();
const hashedKey = createHash('sha256').update('test_key').digest('hex');

async function main() {
    // Delete test session 'session'
    try {
        await prisma.session.delete({ where: { id: 'session' } });
        console.log('Deleted test session: session');
    } catch (e) {
        console.log('Test session "session" not found or already deleted');
    }

    // Delete actual test session if it was created during debug (it wasn't yet)
    try {
        await prisma.session.delete({ where: { id: 'session_1765340861619_0081C6A4' } });
        console.log('Deleted test session: session_1765340861619_0081C6A4');
    } catch (e) {
        // Ignore
    }

    // Delete test API key
    try {
        await prisma.apiKey.deleteMany({ where: { hashedKey } });
        console.log('Deleted test API key');
    } catch (e) {
        console.log('Test API key not found');
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
