// Loads backend/.env for `npm run dev` and `npm start`. Values already present
// in process.env win, so Docker Compose and CI are unaffected. Under Jest the
// test setup file has already run and this is a no-op.
import { config } from "dotenv";
import { z } from "zod";

config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),

  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("1h"),

  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),

  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = Readonly<z.infer<typeof envSchema>> & { corsOrigins: readonly string[] };

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return Object.freeze({
    ...parsed.data,
    corsOrigins: Object.freeze(
      parsed.data.CORS_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  });
}

export const env: Env = loadEnv();
