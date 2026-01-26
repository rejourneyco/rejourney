

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."decrement_recipe_like_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE recipes SET like_count = like_count - 1 WHERE uuid = OLD.recipe_uuid;
    RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."decrement_recipe_like_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_recipe_like_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE recipes SET like_count = like_count + 1 WHERE uuid = NEW.recipe_uuid;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."increment_recipe_like_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_recipe_view_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE recipes SET view_count = view_count + 1 WHERE uuid = NEW.recipe_uuid;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."increment_recipe_view_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_recipe_like"("user_uuid_arg" "uuid", "recipe_uuid_arg" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM recipe_likes
    WHERE user_uuid = user_uuid_arg
    AND recipe_uuid = recipe_uuid_arg
  ) THEN
    DELETE FROM recipe_likes
    WHERE user_uuid = user_uuid_arg
    AND recipe_uuid = recipe_uuid_arg;
  ELSE
    INSERT INTO recipe_likes (user_uuid, recipe_uuid)
    VALUES (user_uuid_arg, recipe_uuid_arg);
  END IF;
END;
$$;


ALTER FUNCTION "public"."toggle_recipe_like"("user_uuid_arg" "uuid", "recipe_uuid_arg" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_like_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE recipes SET like_count = like_count + 1 WHERE uuid = NEW.recipe_uuid;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE recipes SET like_count = GREATEST(like_count - 1, 0) WHERE uuid = OLD.recipe_uuid;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_like_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_recipe_like_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE recipes
    SET like_count = like_count + 1
    WHERE uuid = NEW._recipe_uuid;  -- Use correct column name
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE recipes
    SET like_count = GREATEST(like_count - 1, 0)
    WHERE uuid = OLD._recipe_uuid;  -- Use correct column name
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_recipe_like_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "id" integer NOT NULL,
    "version" "text" NOT NULL,
    "required_version" "text" NOT NULL,
    "maintenance_mode" boolean DEFAULT false NOT NULL,
    "maintenance_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "id_prompt" "text",
    "gen_prompt" "text"
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


ALTER TABLE "public"."app_config" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."app_config_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."recipe_likes" (
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_uuid" "uuid" NOT NULL,
    "recipe_uuid" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."recipe_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recipes" (
    "uuid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "creator_uuid" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "ingredients" "jsonb" NOT NULL,
    "instructions" "jsonb" NOT NULL,
    "image_url" "text",
    "is_published" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "like_count" integer DEFAULT 0,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "image_height" integer,
    "image_width" integer
);


ALTER TABLE "public"."recipes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_pantry" (
    "user_uuid" "uuid" NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_pantry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "uuid" "uuid" NOT NULL,
    "name" "text",
    "email" "text",
    "num_likes_by_me" bigint DEFAULT '0'::bigint,
    "num_liked_me" bigint DEFAULT '0'::bigint,
    "total_num_bews" bigint DEFAULT '0'::bigint,
    "is_pro" boolean DEFAULT false,
    "profile_icon" "text",
    "date_created" timestamp with time zone DEFAULT ("now"() AT TIME ZONE 'utc'::"text")
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipe_likes"
    ADD CONSTRAINT "recipe_likes_pkey" PRIMARY KEY ("uuid");



ALTER TABLE ONLY "public"."recipe_likes"
    ADD CONSTRAINT "recipe_likes_user_uuid_recipe_uuid_key" UNIQUE ("user_uuid", "recipe_uuid");



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_pkey" PRIMARY KEY ("uuid");



ALTER TABLE ONLY "public"."user_pantry"
    ADD CONSTRAINT "user_pantry_pkey" PRIMARY KEY ("user_uuid");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("uuid");



CREATE INDEX "idx_recipe_likes_created_at" ON "public"."recipe_likes" USING "btree" ("created_at");



CREATE INDEX "idx_recipe_likes_recipe_uuid" ON "public"."recipe_likes" USING "btree" ("recipe_uuid");



CREATE INDEX "idx_recipe_likes_user_uuid" ON "public"."recipe_likes" USING "btree" ("user_uuid");



CREATE INDEX "idx_recipes_created_at" ON "public"."recipes" USING "btree" ("created_at");



CREATE INDEX "idx_recipes_creator_uuid" ON "public"."recipes" USING "btree" ("creator_uuid");



CREATE INDEX "idx_recipes_is_published" ON "public"."recipes" USING "btree" ("is_published");



CREATE INDEX "idx_recipes_like_count" ON "public"."recipes" USING "btree" ("like_count");



CREATE OR REPLACE TRIGGER "update_like_count_trigger" AFTER INSERT OR DELETE ON "public"."recipe_likes" FOR EACH ROW EXECUTE FUNCTION "public"."update_like_count"();



CREATE OR REPLACE TRIGGER "update_recipes_updated_at" BEFORE UPDATE ON "public"."recipes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."recipe_likes"
    ADD CONSTRAINT "recipe_likes_recipe_uuid_fkey" FOREIGN KEY ("recipe_uuid") REFERENCES "public"."recipes"("uuid");



ALTER TABLE ONLY "public"."recipe_likes"
    ADD CONSTRAINT "recipe_likes_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "public"."users"("uuid");



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_creator_uuid_fkey" FOREIGN KEY ("creator_uuid") REFERENCES "public"."users"("uuid");



ALTER TABLE ONLY "public"."user_pantry"
    ADD CONSTRAINT "user_pantry_user_uuid_fkey" FOREIGN KEY ("user_uuid") REFERENCES "public"."users"("uuid") ON DELETE CASCADE;



CREATE POLICY "Allow authenticated users to see name/icon" ON "public"."users" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow inserting/deleting likes" ON "public"."recipe_likes" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow like count updates" ON "public"."recipes" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Delete own pantry row" ON "public"."user_pantry" FOR DELETE TO "authenticated" USING (("user_uuid" = "auth"."uid"()));



CREATE POLICY "Enable insert for authenticated users only" ON "public"."recipes" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Enable read access for all users" ON "public"."recipe_likes" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."recipes" FOR SELECT USING (true);



CREATE POLICY "Insert own pantry row" ON "public"."user_pantry" FOR INSERT TO "authenticated" WITH CHECK (("user_uuid" = "auth"."uid"()));



CREATE POLICY "Public read access" ON "public"."app_config" FOR SELECT USING (true);



CREATE POLICY "Select own pantry row" ON "public"."user_pantry" FOR SELECT TO "authenticated" USING (("user_uuid" = "auth"."uid"()));



CREATE POLICY "Update own pantry row" ON "public"."user_pantry" FOR UPDATE TO "authenticated" USING (("user_uuid" = "auth"."uid"())) WITH CHECK (("user_uuid" = "auth"."uid"()));



CREATE POLICY "Users can delete their own recipes" ON "public"."recipes" FOR DELETE USING (("auth"."uid"() = "creator_uuid"));



CREATE POLICY "Users can insert their own profile" ON "public"."users" FOR INSERT WITH CHECK (("auth"."uid"() = "uuid"));



CREATE POLICY "Users can update their own profile" ON "public"."users" FOR UPDATE USING (("auth"."uid"() = "uuid")) WITH CHECK (("auth"."uid"() = "uuid"));



CREATE POLICY "Users can update their own recipes" ON "public"."recipes" FOR UPDATE USING (("auth"."uid"() = "creator_uuid")) WITH CHECK (("auth"."uid"() = "creator_uuid"));



CREATE POLICY "Users can view their own profile" ON "public"."users" FOR SELECT USING (("auth"."uid"() = "uuid"));



ALTER TABLE "public"."app_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recipe_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recipes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_pantry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




















































































































































































GRANT ALL ON FUNCTION "public"."decrement_recipe_like_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."decrement_recipe_like_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."decrement_recipe_like_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_recipe_like_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."increment_recipe_like_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_recipe_like_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_recipe_view_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."increment_recipe_view_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_recipe_view_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."toggle_recipe_like"("user_uuid_arg" "uuid", "recipe_uuid_arg" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_recipe_like"("user_uuid_arg" "uuid", "recipe_uuid_arg" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_recipe_like"("user_uuid_arg" "uuid", "recipe_uuid_arg" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_like_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_like_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_like_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_recipe_like_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_recipe_like_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_recipe_like_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."app_config" TO "anon";
GRANT ALL ON TABLE "public"."app_config" TO "authenticated";
GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON SEQUENCE "public"."app_config_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."app_config_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."app_config_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."recipe_likes" TO "anon";
GRANT ALL ON TABLE "public"."recipe_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."recipe_likes" TO "service_role";



GRANT ALL ON TABLE "public"."recipes" TO "anon";
GRANT ALL ON TABLE "public"."recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."recipes" TO "service_role";



GRANT ALL ON TABLE "public"."user_pantry" TO "anon";
GRANT ALL ON TABLE "public"."user_pantry" TO "authenticated";
GRANT ALL ON TABLE "public"."user_pantry" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























RESET ALL;
