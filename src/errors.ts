import { z } from "zod";

export const errorCodeSchema = z.enum([
  "INVALID_INPUT",
  "NOT_CONFIGURED",
  "UNAUTHORIZED",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "BAND_FAILURE",
  "INVALID_BAND_RESPONSE",
  "BAND_TIMEOUT",
  "BAND_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export const errorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  category: z.enum([
    "validation",
    "configuration",
    "authentication",
    "permission",
    "upstream",
    "internal",
  ]),
  retryable: z.boolean(),
  correlation_id: z.string(),
  result_code: z.number().int().optional(),
});

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type SafeError = z.infer<typeof errorSchema>;
export type ErrorCategory = SafeError["category"];

export class IntegrationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly category: ErrorCategory,
    readonly retryable = false,
    readonly resultCode?: number,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export function normalizeError(
  error: unknown,
  correlationId: string,
): SafeError {
  if (error instanceof IntegrationError) {
    return {
      code: error.code,
      message: error.message,
      category: error.category,
      retryable: error.retryable,
      correlation_id: correlationId,
      ...(error.resultCode === undefined
        ? {}
        : { result_code: error.resultCode }),
    };
  }
  if (error instanceof z.ZodError) {
    return {
      code: "INVALID_INPUT",
      message: "The tool arguments do not match the required schema.",
      category: "validation",
      retryable: false,
      correlation_id: correlationId,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "An internal integration error occurred.",
    category: "internal",
    retryable: false,
    correlation_id: correlationId,
  };
}

export function logFailure(error: SafeError, operation: string): void {
  console.error(
    JSON.stringify({
      event: "integration_error",
      operation,
      code: error.code,
      correlation_id: error.correlation_id,
    }),
  );
}
