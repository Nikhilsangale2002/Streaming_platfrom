export interface SuccessEnvelope<T> {
  success: true;
  message: string;
  data: T;
}

export function ok<T>(data: T, message = "OK"): SuccessEnvelope<T> {
  return { success: true, message, data };
}
