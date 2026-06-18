SET lock_timeout = '5s';
--> statement-breakpoint

ALTER TABLE "teams"
  ADD COLUMN IF NOT EXISTS "workspace_confirmed_at" timestamp;
--> statement-breakpoint

UPDATE "teams" AS t
SET "workspace_confirmed_at" = COALESCE(t."updated_at", t."created_at", NOW())
FROM "users" AS u
WHERE u."id" = t."owner_user_id"
  AND t."workspace_confirmed_at" IS NULL
  AND (
    t."name" IS DISTINCT FROM (split_part(u."email", '@', 1) || '''s Team')
    OR EXISTS (
      SELECT 1
      FROM "projects" AS p
      WHERE p."team_id" = t."id"
        AND p."deleted_at" IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM "projects" AS p
      INNER JOIN "sessions" AS s
        ON s."project_id" = p."id"
      WHERE p."team_id" = t."id"
    )
    OR EXISTS (
      SELECT 1
      FROM "team_members" AS tm
      WHERE tm."team_id" = t."id"
        AND tm."user_id" <> t."owner_user_id"
    )
    OR EXISTS (
      SELECT 1
      FROM "team_invitations" AS ti
      WHERE ti."team_id" = t."id"
    )
  );
