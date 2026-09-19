import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  // isolatedModules: full type-checking is `npm run typecheck`'s job (a
  // separate, mandatory gate); ts-jest only needs to transpile each file
  // independently here, which avoids holding a whole-program TS language
  // service in memory for every test compile.
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json", isolatedModules: true }],
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
