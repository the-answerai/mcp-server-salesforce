import type { Connection } from "jsforce";
import { ConnectionType, ConnectionConfig } from '../types/connection.js';
import { connectionManager, ExecuteWithRetryOptions } from './connectionManager.js';

/**
 * Creates a Salesforce connection using the ConnectionManager
 * @param config Optional connection configuration
 * @param userId Optional user identifier for connection association
 * @returns Connected jsforce Connection instance
 * @deprecated Use ConnectionManager.getConnection() directly for better control
 */
export async function createSalesforceConnection(config?: ConnectionConfig, userId?: string): Promise<any> {
  return await connectionManager.getConnection(userId, config);
}

/**
 * Execute an operation with automatic retry on token expiration
 * @param operation Function to execute with a connection
 * @param options Optional configuration for retry behavior
 * @returns Result of the operation
 */
export async function executeWithRetry<T>(
  operation: (connection: any) => Promise<T>,
  options?: ExecuteWithRetryOptions
): Promise<T> {
  return await connectionManager.executeWithRetry(operation, options);
}