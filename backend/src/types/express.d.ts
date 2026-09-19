import type { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, echoed as the `x-request-id` response header. */
      id: string;
      /** Request-scoped logger already bound to the correlation id. */
      log: Logger;
      /** Output of `validate()`. Populated only for the parts a route declares. */
      validated: {
        body?: unknown;
        params?: unknown;
        query?: unknown;
      };
      /** Set by requireAuth once the JWT is verified and the user is loaded. */
      user?: {
        id: string;
        name: string;
        email: string;
      };
    }
  }
}

export {};
