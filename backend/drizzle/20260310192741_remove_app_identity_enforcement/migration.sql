DROP INDEX "projects_public_key_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "projects_public_key_idx" ON "projects" ("public_key");