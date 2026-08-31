import { HttpErrorResponse } from '@angular/common/http'

/**
 * Pull the useful sentence out of a failed call to your backend.
 *
 * Worth having rather than falling back to a generic string, because the
 * messages Edpire returns are specific and actionable, and a generic
 * "something went wrong" throws them away. The one that will actually happen
 * to you is:
 *
 *   "This API key does not have the 'write:submissions' scope"
 *
 * which is a five-second fix in Integrations and an afternoon of confusion if
 * the UI swallowed it.
 *
 * `HttpErrorResponse.error` holds the parsed JSON body, so `{ error: "..." }`
 * from the server arrives as `err.error.error`. That reads badly and is easy to
 * get wrong, which is the other reason this lives in one place.
 */
export function describeError(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    const body: unknown = err.error
    if (body && typeof body === 'object' && 'error' in body) {
      const message = (body as { error: unknown }).error
      if (typeof message === 'string' && message) return message
    }
    if (err.status === 0) return 'Could not reach the server. Is it running?'
    return `${fallback} (HTTP ${err.status})`
  }
  return err instanceof Error ? err.message : fallback
}
