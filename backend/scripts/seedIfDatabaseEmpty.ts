import { spawn } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 't' || value === 'true' || value === '1';
  if (typeof value === 'number') return value !== 0;
  return false;
}

async function hasExistingDatabaseData(): Promise<boolean> {
  const result = await db.execute(sql`
    select (
      exists(select 1 from users limit 1)
      or exists(select 1 from teams limit 1)
      or exists(select 1 from team_members limit 1)
      or exists(select 1 from projects limit 1)
      or exists(select 1 from api_keys limit 1)
      or exists(select 1 from sessions limit 1)
      or exists(select 1 from session_metrics limit 1)
      or exists(select 1 from recording_artifacts limit 1)
      or exists(select 1 from retention_policies limit 1)
      or exists(select 1 from storage_endpoints limit 1)
      or exists(select 1 from alert_settings limit 1)
      or exists(select 1 from alert_recipients limit 1)
    ) as has_data
  `);

  const rows = (result as any).rows as Array<{ has_data?: unknown }> | undefined;
  return toBoolean(rows?.[0]?.has_data);
}

async function runSeedScript(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/db/seed.ts'],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      },
    );

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Seed exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function main() {
  const hasData = await hasExistingDatabaseData();

  if (hasData) {
    console.log('Skipping seed because the database already contains rows');
    return;
  }

  console.log('Database is empty; running seed script');
  await runSeedScript();
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Conditional seed failed:', error);
    process.exit(1);
  });
