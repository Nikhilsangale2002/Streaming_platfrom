import pino from "pino";
import { redactOptions } from "../../src/utils/logger";

describe("logger redaction", () => {
  it("redacts a passwordHash field nested in a logged object", () => {
    const chunks: string[] = [];
    const stream = {
      write: (chunk: string) => {
        chunks.push(chunk);
      },
    };

    // logger.child() does not let a child redirect output to a different
    // destination stream -- it still writes through the parent's stream.
    // To capture output for a real assertion, build an isolated pino
    // instance with the exact same redact config, pointed at this stream.
    const testLogger = pino({ redact: redactOptions }, stream);

    testLogger.info({ user: { passwordHash: "super-secret-hash" } }, "test event");

    const logged = chunks.join("");
    expect(logged).not.toContain("super-secret-hash");
    expect(logged).toContain("[redacted]");
  });
});
