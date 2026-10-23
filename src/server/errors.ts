import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Domain error rendered as RFC 7807 problem+json. `code` is a stable machine-readable
 * identifier and also the glossary key suffix (`error.<code>`) used for the localized title.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    public readonly detail?: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export const notFound = () => new ApiError(404, 'not_found');
export const forbidden = () => new ApiError(403, 'forbidden');
export const badRequest = (detail?: string, extra?: Record<string, unknown>) =>
  new ApiError(400, 'validation_failed', detail, extra);
