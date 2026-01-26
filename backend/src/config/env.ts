import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  DASHBOARD_ORIGIN: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(), // For presigned URLs in local dev (external IP)
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_SHADOW_BUCKET: z.string().optional(),
  S3_PRIMARY_ENDPOINT_ID: z.string().optional(),
  S3_SHADOW_ENDPOINT_ID: z.string().optional(),
  INGEST_HMAC_SECRET: z.string().min(1, "INGEST_HMAC_SECRET is required"),
  JWT_SECRET: z.string().optional(),
  JWT_SIGNING_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  SELF_HOSTED_MODE: z.coerce.boolean().optional().default(false),
  TURNSTILE_SITE_KEY: z.string().optional(),
  OAUTH_REDIRECT_BASE: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_LOOKUP_KEY: z.string().optional(),
  STRIPE_PRICE_MINUTE_TIERED: z.string().optional(),
  BILLING_RETURN_URL: z.string().optional(),
  BILLING_CANCEL_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().optional()
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.errors
      .map((err) => `${err.path.join(".")}: ${err.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  const merged = {
    ...parsed.data,
    JWT_SECRET: parsed.data.JWT_SECRET ?? parsed.data.JWT_SIGNING_KEY,
    STRIPE_PRICE_LOOKUP_KEY:
      parsed.data.STRIPE_PRICE_LOOKUP_KEY ?? parsed.data.STRIPE_PRICE_MINUTE_TIERED
  };

  cachedEnv = merged;
  return cachedEnv;
}

