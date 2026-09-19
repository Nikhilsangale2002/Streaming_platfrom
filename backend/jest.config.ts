import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  // Runs before the test framework and before any module import, so
  // config/env.ts sees a fully populated, test-safe environment.
  setupFiles: ["<rootDir>/tests/helpers/env.setup.ts"],
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/server.ts",
    "!src/config/env.ts",
    "!src/db/**",
    "!src/types/**",
  ],
  coverageDirectory: "coverage",
  testTimeout: 15000,
};

export default config;
