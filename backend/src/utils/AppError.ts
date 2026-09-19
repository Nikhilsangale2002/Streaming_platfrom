/**
 * An error the application raised deliberately. The `code` is a stable,
 * machine-readable identifier clients branch on; `message` is prose that may
 * change without notice.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
    Error.captureStackTrace(this, AppError);
  }
}
