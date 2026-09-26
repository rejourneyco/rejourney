import { eq, sql } from 'drizzle-orm';

import { db, issues, projects } from '../src/db/client.js';
import { logger } from '../src/logger.js';
import { issueShortIdPrefix, lockIssueShortIds, nextIssueNumber } from '../src/services/issueTracker.js';

// Short IDs were `count(*) + 1`, so issues created concurrently could share one. This keeps
// the earliest issue's label and gives each later duplicate the project's next number.
// Dry run by default; APPLY=1 writes. PROJECT_ID limits it to one project. Each project is
// one short transaction under the same lock new issues take.
async function main() {
  const apply = process.env.APPLY === '1';
  const projectFilter = process.env.PROJECT_ID?.trim();

  const duplicated = await db
    .select({ projectId: issues.projectId })
    .from(issues)
    .where(projectFilter ? eq(issues.projectId, projectFilter) : undefined)
    .groupBy(issues.projectId, issues.shortId)
    .having(sql`count(*) > 1`);
  const projectIds = [...new Set(duplicated.map((row) => row.projectId))];

  let renumbered = 0;
  for (const projectId of projectIds) {
    const changes = await db.transaction(async (tx) => {
      await lockIssueShortIds(tx, projectId);
      const [project] = await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1);
      const prefix = issueShortIdPrefix(project?.name);
      const rows = await tx
        .select({ id: issues.id, shortId: issues.shortId })
        .from(issues)
        .where(eq(issues.projectId, projectId))
        .orderBy(issues.createdAt, issues.id);

      let next = await nextIssueNumber(tx, projectId);
      const seen = new Set<string>();
      const planned: Array<{ id: string; from: string; to: string }> = [];
      for (const row of rows) {
        if (!seen.has(row.shortId)) { seen.add(row.shortId); continue; }
        planned.push({ id: row.id, from: row.shortId, to: `${prefix}-${next++}` });
      }
      if (apply) {
        for (const change of planned) await tx.update(issues).set({ shortId: change.to }).where(eq(issues.id, change.id));
      }
      return planned;
    });
    renumbered += changes.length;
    logger.info({ projectId, apply, renumbered: changes.length, sample: changes.slice(0, 10) }, 'Duplicate issue short IDs');
  }

  logger.info({ apply, projects: projectIds.length, renumbered }, apply ? 'Renumbered duplicate issue short IDs' : 'Dry run: set APPLY=1 to renumber');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ error }, 'Duplicate issue short ID repair failed');
    process.exit(1);
  });
