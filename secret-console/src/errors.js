'use strict';

class ConsoleError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'ConsoleError';
    this.code = code;
    this.status = status;
  }
}

const SAFE_MESSAGES = Object.freeze({
  NOT_FOUND: 'The requested synthetic resource was not found.',
  METHOD_NOT_ALLOWED: 'The method is not allowed for this route.',
  CONTENT_TYPE_INVALID: 'A JSON request body is required.',
  REQUEST_TOO_LARGE: 'The request is too large.',
  REQUEST_INVALID: 'The request is invalid.',
  SECRET_INPUT_INVALID: 'The credential input is invalid.',
  ROTATION_ACTIVE: 'An active rotation already exists for this credential.',
  ROTATION_STATE_CONFLICT: 'The rotation cannot perform this action in its current state.',
  HUMAN_APPROVAL_REQUIRED: 'Explicit Human approval is required.',
  CONNECTIVITY_FAILED: 'The synthetic connectivity check failed.',
  AUDIT_PERSISTENCE_FAILED: 'The synthetic audit event could not be persisted.',
  INTERNAL_ERROR: 'The prototype could not complete the request.'
});

function safeError(error) {
  const code = error instanceof ConsoleError && SAFE_MESSAGES[error.code]
    ? error.code
    : 'INTERNAL_ERROR';
  return {
    status: error instanceof ConsoleError ? error.status : 500,
    body: {
      success: false,
      error: {
        code,
        message: SAFE_MESSAGES[code]
      }
    }
  };
}

module.exports = { ConsoleError, SAFE_MESSAGES, safeError };
