import type { Connection } from "jsforce";

interface ErrorResult {
    success: boolean;
    fullName?: string;
    errors?: Array<{ message: string; statusCode?: string; fields?: string | string[]; }> | 
            { message: string; statusCode?: string; fields?: string | string[]; };
  }

/**
 * Check if error indicates token expiration or session invalidity
 */
export function isTokenExpiredError(error: any): boolean {
  if (!error) return false;

  // Check error code
  if (error.errorCode === 'INVALID_SESSION_ID' || 
      error.errorCode === 'SESSION_NOT_FOUND' ||
      error.errorCode === 'INVALID_SESSION') {
    return true;
  }

  // Check HTTP status
  if (error.statusCode === 401 || error.status === 401) {
    return true;
  }

  // Check error message content
  const message = error.message?.toLowerCase() || '';
  if (message.includes('session expired') ||
      message.includes('invalid session') ||
      message.includes('authentication failure') ||
      message.includes('session not found')) {
    return true;
  }

  // Check jsforce specific errors
  if (error.name === 'INVALID_SESSION_ID') {
    return true;
  }

  return false;
}

/**
 * Check if error indicates OAuth-specific issues
 */
export function isOAuthError(error: any): boolean {
  if (!error) return false;

  const message = error.message?.toLowerCase() || '';
  return message.includes('oauth') ||
         message.includes('access_denied') ||
         message.includes('invalid_grant') ||
         message.includes('invalid_client') ||
         error.error === 'invalid_grant' ||
         error.error === 'access_denied';
}

/**
 * Handle connection errors with automatic retry logic
 */
export async function handleConnectionError(
  error: any,
  connection: any,
  retryFn: () => Promise<any>,
  maxRetries: number = 1
): Promise<any> {
  if (isTokenExpiredError(error)) {
    if (maxRetries > 0) {
      console.error('Token expired, attempting to refresh connection...');
      
      try {
        // Try to refresh the connection using jsforce's built-in refresh capability
        if (connection.oauth2 && connection.oauth2.clientId) {
          await connection.oauth2.refreshToken(connection.refreshToken || '');
          console.error('Connection refreshed successfully, retrying operation...');
          return await retryFn();
        } else {
          throw new Error('No refresh capability available for this connection type');
        }
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
        throw new ConnectionError(
          'Session expired and token refresh failed. Please re-authenticate.',
          'TOKEN_REFRESH_FAILED',
          true
        );
      }
    } else {
      throw new ConnectionError(
        'Session expired. Please re-authenticate.',
        'SESSION_EXPIRED',
        true
      );
    }
  }

  if (isOAuthError(error)) {
    throw new ConnectionError(
      'OAuth authentication failed. Please check your credentials and re-authenticate.',
      'OAUTH_ERROR',
      true
    );
  }

  // Re-throw non-authentication errors
  throw error;
}

/**
 * Custom error class for connection-related issues
 */
export class ConnectionError extends Error {
  public readonly code: string;
  public readonly requiresReauth: boolean;

  constructor(message: string, code: string, requiresReauth: boolean = false) {
    super(message);
    this.name = 'ConnectionError';
    this.code = code;
    this.requiresReauth = requiresReauth;
  }
}

/**
 * Create user-friendly error message for authentication failures
 */
export function formatAuthenticationError(error: any): string {
  if (isTokenExpiredError(error)) {
    return 'Your Salesforce session has expired. Please re-authenticate to continue.';
  }

  if (isOAuthError(error)) {
    return 'OAuth authentication failed. Please check your client credentials and try again.';
  }

  if (error.message?.includes('INVALID_LOGIN')) {
    return 'Invalid username, password, or security token. Please verify your credentials.';
  }

  // Default error message
  return `Authentication failed: ${error.message || 'Unknown error'}`;
}

/**
 * Determine if operation should be retried based on error type
 */
export function shouldRetryOperation(error: any): boolean {
  // Don't retry authentication errors
  if (isTokenExpiredError(error) || isOAuthError(error)) {
    return false;
  }

  // Don't retry validation errors
  if (error.name === 'ValidationError' || error.errorCode === 'VALIDATION_ERROR') {
    return false;
  }

  // Retry network and temporary errors
  const retryableErrors = [
    'NETWORK_ERROR',
    'TIMEOUT',
    'SERVER_UNAVAILABLE',
    'SERVICE_UNAVAILABLE',
    'TOO_MANY_REQUESTS'
  ];

  return retryableErrors.includes(error.errorCode) ||
         error.message?.includes('timeout') ||
         error.message?.includes('network') ||
         (error.statusCode >= 500 && error.statusCode < 600);
}
  
export function formatMetadataError(result: ErrorResult | ErrorResult[], operation: string): string {
    let errorMessage = `Failed to ${operation}`;
    const saveResult = Array.isArray(result) ? result[0] : result;
    
    if (saveResult && saveResult.errors) {
      if (Array.isArray(saveResult.errors)) {
        errorMessage += ': ' + saveResult.errors.map((e: { message: string }) => e.message).join(', ');
      } else if (typeof saveResult.errors === 'object') {
        const error = saveResult.errors;
        errorMessage += `: ${error.message}`;
        if (error.fields) {
          errorMessage += ` (Field: ${error.fields})`;
        }
        if (error.statusCode) {
          errorMessage += ` [${error.statusCode}]`;
        }
      } else {
        errorMessage += ': ' + String(saveResult.errors);
      }
    }
  
    return errorMessage;
  }