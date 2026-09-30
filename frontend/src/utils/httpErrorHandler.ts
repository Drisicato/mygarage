/**
 * HTTP Error Handler Utility
 *
 * Maps HTTP status codes to user-friendly error messages.
 * Complements backend error handling standardization (v2.11.0).
 *
 * These functions run outside React (interceptors, service helpers, catch
 * blocks) so there is no component to call useTranslation from. They read the
 * i18next singleton defensively via `tSafe`, mirroring the pattern in
 * components/ErrorBoundary.tsx: a hard English default plus a try/catch, so an
 * error path can never itself throw or render a raw key.
 *
 * Backend-supplied `detail` text is passed through verbatim — only the generic
 * fallbacks below are translated.
 */

import { AxiosError } from 'axios'
import i18next from 'i18next'
import { parseValidationErrors, isValidationProblemArray } from './apiValidation'
import type { FieldProblem } from './apiValidation'

/**
 * Translate an error string without ever risking a throw.
 *
 * Error handling has to keep working when i18n is the thing that broke (not
 * initialised yet, namespace failed to load). An English message beats an
 * exception inside a catch block.
 */
function tSafe(key: string, fallback: string, values?: Record<string, unknown>): string {
  try {
    const value = i18next.t(key, { ns: 'common', defaultValue: fallback, ...values })
    return typeof value === 'string' && value.length > 0 ? value : fallback
  } catch {
    return fallback
  }
}

/** A translation key paired with its hard English fallback. */
type Message = readonly [key: string, fallback: string]

/**
 * HTTP status code to user-friendly message mapping
 */
const STATUS_MESSAGES: Record<number, Message> = {
  400: ['httpError.status.badRequest', 'Invalid request. Please check your input.'],
  401: ['httpError.status.unauthorized', 'Session expired. Please log in again.'],
  403: ['httpError.status.forbidden', 'You do not have permission to perform this action.'],
  404: ['httpError.status.notFound', 'The requested resource was not found.'],
  409: ['httpError.status.conflict', 'This action conflicts with existing data.'],
  422: ['httpError.status.unprocessable', 'The submitted data could not be processed.'],
  500: ['httpError.status.serverError', 'An unexpected server error occurred.'],
  502: ['httpError.status.badGateway', 'Server is temporarily unavailable. Please try again.'],
  503: [
    'httpError.status.serviceUnavailable',
    'Service temporarily unavailable. Please try again shortly.',
  ],
  504: ['httpError.status.gatewayTimeout', 'Request timed out. Please try again.'],
}

/**
 * Context-specific error messages for common operations
 */
const CONTEXT_MESSAGES: Record<string, Record<number, Message>> = {
  database: {
    409: ['httpError.database.conflict', 'A record with this data already exists.'],
    503: ['httpError.database.unavailable', 'Database temporarily unavailable. Please try again.'],
  },
  file: {
    403: ['httpError.file.forbidden', 'Permission denied. Cannot access file.'],
    404: ['httpError.file.notFound', 'File not found.'],
    500: ['httpError.file.serverError', 'Error accessing file.'],
  },
  external_api: {
    503: [
      'httpError.externalApi.unavailable',
      'External service unavailable. Please try again later.',
    ],
    504: ['httpError.externalApi.timeout', 'External service timed out. Please try again.'],
  },
}

const NETWORK_ERROR: Message = [
  'httpError.network',
  'Network error. Please check your connection.',
]
const GENERIC_ERROR: Message = ['httpError.generic', 'An error occurred.']
const UNEXPECTED_ERROR: Message = ['httpError.unexpected', 'An unexpected error occurred.']

/** Resolve a (key, English) pair through i18next. */
const translate = ([key, fallback]: Message): string => tSafe(key, fallback)

export interface ParsedApiError {
  /** HTTP status code (0 for network errors) */
  status: number
  /** User-friendly error message */
  message: string
  /** Raw error detail from API response */
  detail?: string
  /** Field-addressable problems from a 422. Empty for every other error. */
  fieldErrors: FieldProblem[]
  /** Whether this is a network/connectivity error */
  isNetworkError: boolean
  /** Whether this is a timeout error */
  isTimeout: boolean
  /** Whether user should retry the operation */
  shouldRetry: boolean
}

/**
 * Parse an API error into a structured format with user-friendly message.
 *
 * @param error - The error from an API call (typically AxiosError)
 * @param context - Optional context for more specific messages ('database', 'file', 'external_api')
 * @returns Parsed error with user-friendly message
 */
export function parseApiError(error: unknown, context?: string): ParsedApiError {
  // Handle Axios errors
  if (isAxiosError(error)) {
    const status = error.response?.status || 0
    // MyGarage's validation handler sends the 422 list as `details`; FastAPI's
    // default and a raised HTTPException use `detail`. Reading only `detail`
    // meant no 422 ever reached a field, so every form fell back to the banner.
    const data = error.response?.data as { detail?: unknown; details?: unknown } | undefined
    const rawDetail = data?.detail ?? data?.details
    const fieldErrors = parseValidationErrors(rawDetail)
    // `detail` is human-facing text ONLY. A 422 sends an array, which must never
    // be stringified into a toast — fieldErrors carries that content. Falling
    // back to `error.message` here (axios's own "Request failed with status
    // code NNN") reintroduces the exact opaque string this release exists to
    // remove, and it's the ONLY body shape axios leaves reachable on the 11
    // `responseType: 'blob'` download sites (the error body arrives as an
    // unreadable Blob, so `.detail` never resolves there) plus any non-JSON
    // error page from a proxy. Leave `detail` undefined instead so
    // `getActionErrorMessage` falls through to its translated template.
    const detail = isValidationProblemArray(rawDetail)
      ? undefined
      : typeof rawDetail === 'string'
        ? rawDetail
        : undefined

    // Network error (no response)
    if (!error.response) {
      return {
        status: 0,
        message: translate(NETWORK_ERROR),
        detail: error.message,
        fieldErrors: [],
        isNetworkError: true,
        isTimeout: error.code === 'ECONNABORTED',
        shouldRetry: true,
      }
    }

    // Context-specific message if available, else the general status message
    const entry = CONTEXT_MESSAGES[context || '']?.[status] ?? STATUS_MESSAGES[status]
    let message = entry ? translate(entry) : translate(GENERIC_ERROR)

    // For 409 conflicts, use the API detail if it's more specific
    if (status === 409 && detail && !detail.includes('Exception')) {
      message = detail
    }

    return {
      status,
      message,
      detail,
      fieldErrors,
      isNetworkError: false,
      isTimeout: status === 504,
      shouldRetry: [502, 503, 504].includes(status),
    }
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    return {
      status: 0,
      message: error.message || translate(GENERIC_ERROR),
      detail: error.message,
      fieldErrors: [],
      isNetworkError: false,
      isTimeout: false,
      shouldRetry: false,
    }
  }

  // Handle unknown errors
  return {
    status: 0,
    message: translate(UNEXPECTED_ERROR),
    detail: String(error),
    fieldErrors: [],
    isNetworkError: false,
    isTimeout: false,
    shouldRetry: false,
  }
}

/**
 * Get a user-friendly error message from an API error.
 * Convenience function for simple error display.
 *
 * @param error - The error from an API call
 * @param fallbackMessage - Optional fallback message (already user-ready text)
 * @returns User-friendly error message
 */
export function getErrorMessage(error: unknown, fallbackMessage?: string): string {
  const parsed = parseApiError(error)
  return parsed.message || fallbackMessage || translate(GENERIC_ERROR)
}

/**
 * Get error message with action context.
 *
 * @param error - The error from an API call
 * @param action - The action being performed (e.g., 'save', 'delete', 'load')
 * @returns Contextual error message
 */
export function getActionErrorMessage(error: unknown, action: string): string {
  const parsed = parseApiError(error)
  const failed = (): string =>
    tSafe('httpError.actionFailed', 'Failed to {{action}}. {{message}}', {
      action,
      message: parsed.message,
    })

  // For timeouts and service unavailable, add retry suggestion
  if (parsed.shouldRetry) {
    return failed()
  }

  // For validation errors, not-found lookups, and auth rejections, show the
  // backend detail verbatim when there is one. A 404 raised as
  // `HTTPException(404, "X not found")` is exactly as specific as a 422's
  // message — letting it fall through to the generic "resource not found"
  // template below (`failed()`) discards that specificity at every call site
  // that surfaces a 404 (e.g. "Vehicle not found" vs "Share not found" vs
  // "Backup file not found"). 401/403 need the same treatment: login's
  // "Incorrect username or password" (401), "User account is inactive" (403),
  // and "Registration is disabled. Please contact an administrator…" (403)
  // are all specific, user-actionable backend text — without this branch they
  // fell through to `failed()`'s generic "Session expired" / "permission"
  // templates, which is actively FALSE for a login-page typo. Requires C1
  // (the `error.message` fallback removed from `parsed.detail`) so a
  // detail-less 401/403 falls through to the translated
  // `actionFailedCheckInput` template below rather than an axios status line.
  if ([400, 401, 403, 404, 422].includes(parsed.status)) {
    return (
      parsed.detail ||
      tSafe('httpError.actionFailedCheckInput', 'Failed to {{action}}. Please check your input.', {
        action,
      })
    )
  }

  // For conflicts, the message is usually descriptive enough
  if (parsed.status === 409) {
    return parsed.message
  }

  return failed()
}

/**
 * Type guard for AxiosError
 */
function isAxiosError(error: unknown): error is AxiosError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'isAxiosError' in error &&
    (error as AxiosError).isAxiosError === true
  )
}

/**
 * Determine if an error should trigger a retry attempt.
 *
 * @param error - The error from an API call
 * @returns Whether retry is recommended
 */
export function shouldRetryRequest(error: unknown): boolean {
  const parsed = parseApiError(error)
  return parsed.shouldRetry || parsed.isNetworkError
}

/**
 * Check if error is an authentication error requiring login.
 *
 * @param error - The error from an API call
 * @returns Whether this is an auth error
 */
export function isAuthError(error: unknown): boolean {
  if (isAxiosError(error)) {
    return error.response?.status === 401
  }
  return false
}

/**
 * Check if error is a permission/authorization error.
 *
 * @param error - The error from an API call
 * @returns Whether this is a permission error
 */
export function isPermissionError(error: unknown): boolean {
  if (isAxiosError(error)) {
    return error.response?.status === 403
  }
  return false
}
