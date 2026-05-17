CREATE TABLE "roadmap_posts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "author_user_id" uuid,
    "title" varchar(160) NOT NULL,
    "details" text NOT NULL,
    "status" varchar(32) DEFAULT 'open' NOT NULL,
    "developer_comment" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "roadmap_votes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "post_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "roadmap_posts"
    ADD CONSTRAINT "roadmap_posts_author_user_id_users_id_fk"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "roadmap_votes"
    ADD CONSTRAINT "roadmap_votes_post_id_roadmap_posts_id_fk"
    FOREIGN KEY ("post_id") REFERENCES "roadmap_posts"("id") ON DELETE CASCADE;

ALTER TABLE "roadmap_votes"
    ADD CONSTRAINT "roadmap_votes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE INDEX "roadmap_posts_author_user_id_idx" ON "roadmap_posts" ("author_user_id");
CREATE INDEX "roadmap_posts_status_created_at_idx" ON "roadmap_posts" ("status", "created_at");
CREATE UNIQUE INDEX "roadmap_votes_post_user_unique" ON "roadmap_votes" ("post_id", "user_id");
CREATE INDEX "roadmap_votes_post_id_idx" ON "roadmap_votes" ("post_id");
CREATE INDEX "roadmap_votes_user_id_idx" ON "roadmap_votes" ("user_id");
