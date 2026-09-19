import path from "node:path";
import { config } from "dotenv";

// Local runs read backend/.env. In CI the variables are already exported and
// dotenv does not overwrite existing values, so this is a no-op there.
config({ path: path.resolve(__dirname, "../../.env") });

process.env.NODE_ENV = "test";

// Tests delete every collection and flush the Redis database between cases.
// Force a dedicated database name and a non-default Redis db so that running
// the suite against a developer's .env can never destroy their working data.
const mongoUri = process.env.MONGO_URI ?? "mongodb://localhost:27017/lvs_streaming";
process.env.MONGO_URI = mongoUri.endsWith("_test") ? mongoUri : `${mongoUri}_test`;

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = "/1";
process.env.REDIS_URL = redisUrl.toString();

// Placeholder that satisfies the 32-character floor enforced from Task 4.
process.env.JWT_SECRET ??= "test-jwt-secret-at-least-thirty-two-chars";
