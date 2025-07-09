import { TokenData, PersonalOAuthConfig } from '../types/connection.js';
import { tokenManager } from '../utils/tokenManager.js';
import { ConnectionError } from '../utils/errorHandler.js';
import { getUserInfo, generateUserId } from '../utils/userInfo.js';
import jsforce from 'jsforce';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * OAuth authorization parameters
 */
export interface AuthParams {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  prompt?: string;
  instanceUrl?: string;
}

/**
 * OAuth callback data
 */
export interface OAuthCallback {
  code: string;
  state: string;
  error?: string;
  error_description?: string;
}

/**
 * Handles personal OAuth 2.0 authorization flow for Salesforce
 */
export class PersonalOAuthHandler {
  private pendingStates = new Map<string, { timestamp: number; userId: string }>();
  private readonly STATE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  private stateFile: string;

  constructor() {
    // Store states in ~/.config/mcp-server-salesforce/oauth_states.json
    const configDir = path.join(os.homedir(), '.config', 'mcp-server-salesforce');
    this.stateFile = path.join(configDir, 'oauth_states.json');
    
    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    
    // Load existing states on startup
    this.loadStatesFromFile();
  }

  /**
   * Load states from persistent storage
   */
  private loadStatesFromFile(): void {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        const stateData = JSON.parse(data);
        
        // Convert stored data back to Map
        for (const [state, info] of Object.entries(stateData)) {
          this.pendingStates.set(state, info as { timestamp: number; userId: string });
        }
        
        console.error(`Loaded ${this.pendingStates.size} OAuth states from ${this.stateFile}`);
      }
    } catch (error) {
      console.error('Failed to load OAuth states from file:', error);
    }
  }

  /**
   * Save states to persistent storage
   */
  private saveStatesToFile(): void {
    try {
      const stateData: Record<string, any> = {};
      
      for (const [state, info] of this.pendingStates.entries()) {
        stateData[state] = info;
      }
      
      fs.writeFileSync(this.stateFile, JSON.stringify(stateData, null, 2), { 
        mode: 0o600 // Only user readable/writable
      });
      
      console.error(`Saved ${this.pendingStates.size} OAuth states to ${this.stateFile}`);
    } catch (error) {
      console.error('Failed to save OAuth states to file:', error);
    }
  }

  /**
   * Initiate OAuth authorization flow
   */
  async initiateAuthFlow(
    params: AuthParams,
    userId: string
  ): Promise<{ authUrl: string; state: string }> {
    // Generate secure state parameter
    const state = this.generateState();
    
    // Store state for validation
    this.pendingStates.set(state, {
      timestamp: Date.now(),
      userId
    });
    
    // Persist to disk
    this.saveStatesToFile();

    // Clean up expired states
    this.cleanupExpiredStates();

    const authUrl = this.getAuthorizationUrl({
      ...params,
      state
    });

    console.error(`OAuth flow initiated for user: ${userId}, state: ${state}`);
    
    return { authUrl, state };
  }

  /**
   * Handle OAuth implicit flow callback (when access_token is provided directly)
   */
  async handleImplicitCallback(
    accessToken: string,
    state: string,
    idUrl?: string
  ): Promise<{ tokenData: TokenData; userId: string; userInfo: any }> {
    console.error(`DEBUG: handleImplicitCallback called with state: ${state}`);
    console.error(`DEBUG: Available states: ${Array.from(this.pendingStates.keys()).join(', ')}`);
    
    // Validate state parameter
    const stateInfo = this.pendingStates.get(state);
    if (!stateInfo) {
      console.error(`DEBUG: State not found in pendingStates`);
      throw new ConnectionError(
        'Invalid or expired state parameter',
        'INVALID_STATE'
      );
    }

    // Check state timeout
    const timeElapsed = Date.now() - stateInfo.timestamp;
    console.error(`DEBUG: State age: ${timeElapsed}ms, timeout: ${this.STATE_TIMEOUT_MS}ms`);
    if (timeElapsed > this.STATE_TIMEOUT_MS) {
      this.pendingStates.delete(state);
      throw new ConnectionError(
        'OAuth state has expired, please restart the authorization flow',
        'STATE_EXPIRED'
      );
    }

    try {
      // Clean up state
      this.pendingStates.delete(state);
      this.saveStatesToFile();

      // Create token data (note: implicit flow doesn't provide refresh token)
      const instanceUrl = process.env.SALESFORCE_INSTANCE_URL || 'https://login.salesforce.com';
      
      const tokenData: TokenData = {
        accessToken: accessToken,
        instanceUrl: instanceUrl,
        expiresAt: new Date(Date.now() + 7200 * 1000) // Default 2 hours for implicit flow
        // Note: No refresh token in implicit flow
      };

      // Get user info using the access token - create a temporary connection
      const tempConnection = new jsforce.Connection({
        instanceUrl: instanceUrl,
        accessToken: accessToken
      });
      const userInfo = await getUserInfo(tempConnection);
      if (!userInfo) {
        throw new ConnectionError(
          'Failed to retrieve user information with access token',
          'USER_INFO_FAILED'
        );
      }
      const actualUserId = userInfo.userId;

      // Store tokens with the actual user ID
      await tokenManager.storeToken(actualUserId, {
        ...tokenData,
        userId: actualUserId
      });

      console.error(`OAuth implicit callback processed successfully for user: ${actualUserId} (${userInfo.displayName})`);

      return {
        tokenData: {
          ...tokenData,
          userId: actualUserId
        },
        userId: actualUserId,
        userInfo
      };
    } catch (error) {
      console.error(`OAuth implicit callback processing failed for user: ${stateInfo.userId}`, error);
      throw new ConnectionError(
        `OAuth implicit callback failed: ${error instanceof Error ? error.message : String(error)}`,
        'OAUTH_CALLBACK_FAILED'
      );
    }
  }

  /**
   * Handle OAuth callback with authorization code
   */
  async handleCallback(
    callback: OAuthCallback,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    instanceUrl?: string
  ): Promise<{ tokenData: TokenData; userId: string; userInfo: any }> {
    // Check for OAuth errors
    if (callback.error) {
      throw new ConnectionError(
        `OAuth authorization failed: ${callback.error} - ${callback.error_description || 'Unknown error'}`,
        'OAUTH_AUTHORIZATION_FAILED'
      );
    }

    // Validate state parameter
    const stateInfo = this.pendingStates.get(callback.state);
    if (!stateInfo) {
      throw new ConnectionError(
        'Invalid or expired state parameter',
        'INVALID_STATE'
      );
    }

    // Check state timeout
    if (Date.now() - stateInfo.timestamp > this.STATE_TIMEOUT_MS) {
      this.pendingStates.delete(callback.state);
      throw new ConnectionError(
        'OAuth state has expired, please restart the authorization flow',
        'STATE_EXPIRED'
      );
    }

    // Clean up state
    this.pendingStates.delete(callback.state);

    try {
      // Exchange authorization code for tokens
      const tokenData = await tokenManager.exchangeCodeForTokens(
        callback.code,
        clientId,
        clientSecret,
        redirectUri,
        instanceUrl || 'https://login.salesforce.com'
      );

      // Create a temporary connection to get user information
      const tempConnection = new jsforce.Connection({
        instanceUrl: tokenData.instanceUrl,
        accessToken: tokenData.accessToken
      });

      // Get user information from Salesforce
      const userInfo = await getUserInfo(tempConnection);
      
      if (!userInfo) {
        throw new ConnectionError('Failed to retrieve user information from Salesforce', 'USER_INFO_FAILED');
      }

      // Generate user-friendly identifier
      const actualUserId = generateUserId(userInfo);

      // Store tokens with the actual user ID
      await tokenManager.storeToken(actualUserId, {
        ...tokenData,
        userId: actualUserId
      });

      console.error(`OAuth callback processed successfully for user: ${actualUserId} (${userInfo.displayName})`);

      return {
        tokenData: {
          ...tokenData,
          userId: actualUserId
        },
        userId: actualUserId,
        userInfo
      };
    } catch (error) {
      console.error(`OAuth callback processing failed for user: ${stateInfo.userId}`, error);
      throw new ConnectionError(
        `Failed to exchange authorization code: ${error instanceof Error ? error.message : String(error)}`,
        'CODE_EXCHANGE_FAILED'
      );
    }
  }

  /**
   * Get authorization URL for OAuth flow
   */
  getAuthorizationUrl(params: AuthParams): string {
    const baseUrl = params.instanceUrl || 'https://login.salesforce.com';
    const authUrl = new URL('/services/oauth2/authorize', baseUrl);
    
    // Required parameters
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('client_id', params.clientId);
    authUrl.searchParams.set('redirect_uri', params.redirectUri);
    
    // Set default scope for personal OAuth if not provided
    const defaultScope = 'id api refresh_token';
    authUrl.searchParams.set('scope', params.scope || defaultScope);
    
    if (params.state) {
      authUrl.searchParams.set('state', params.state);
    }
    
    if (params.prompt) {
      authUrl.searchParams.set('prompt', params.prompt);
    }

    return authUrl.toString();
  }

  /**
   * Refresh tokens for a user
   */
  async refreshUserTokens(
    userId: string,
    clientId: string,
    clientSecret: string,
    instanceUrl?: string
  ): Promise<TokenData> {
    try {
      const newTokenData = await tokenManager.refreshToken(
        userId,
        clientId,
        clientSecret,
        instanceUrl || 'https://login.salesforce.com'
      );

      console.error(`Tokens refreshed for user: ${userId}`);
      return newTokenData;
    } catch (error) {
      console.error(`Token refresh failed for user: ${userId}`, error);
      throw new ConnectionError(
        `Failed to refresh tokens: ${error instanceof Error ? error.message : String(error)}`,
        'TOKEN_REFRESH_FAILED',
        true
      );
    }
  }

  /**
   * Revoke tokens for a user
   */
  async revokeUserTokens(
    userId: string,
    clientId: string,
    clientSecret: string,
    instanceUrl?: string
  ): Promise<void> {
    const tokenData = await tokenManager.getToken(userId);
    if (!tokenData) {
      throw new ConnectionError(`No tokens found for user: ${userId}`, 'NO_TOKENS_FOUND');
    }

    try {
      // Revoke access token
      await this.revokeToken(
        tokenData.accessToken,
        clientId,
        clientSecret,
        instanceUrl || tokenData.instanceUrl
      );

      // Revoke refresh token if available
      if (tokenData.refreshToken) {
        await this.revokeToken(
          tokenData.refreshToken,
          clientId,
          clientSecret,
          instanceUrl || tokenData.instanceUrl
        );
      }

      // Clear stored tokens
      tokenManager.clearToken(userId);

      console.error(`Tokens revoked for user: ${userId}`);
    } catch (error) {
      console.error(`Token revocation failed for user: ${userId}`, error);
      // Still clear local tokens even if revocation failed
      tokenManager.clearToken(userId);
      throw new ConnectionError(
        `Failed to revoke tokens: ${error instanceof Error ? error.message : String(error)}`,
        'TOKEN_REVOCATION_FAILED'
      );
    }
  }

  /**
   * Check if user has valid tokens
   */
  async hasValidTokens(userId: string): Promise<boolean> {
    const tokenData = await tokenManager.getToken(userId);
    return tokenData !== null && !tokenManager.isTokenExpired(tokenData);
  }

  /**
   * Get user's token information (without sensitive data)
   */
  async getUserTokenInfo(userId: string): Promise<{
    hasTokens: boolean;
    instanceUrl?: string;
    scope?: string;
    expiresAt?: Date;
    isExpired?: boolean;
  } | null> {
    const tokenData = await tokenManager.getToken(userId);
    
    if (!tokenData) {
      return {
        hasTokens: false
      };
    }

    return {
      hasTokens: true,
      instanceUrl: tokenData.instanceUrl,
      scope: tokenData.scope,
      expiresAt: tokenData.expiresAt,
      isExpired: tokenManager.isTokenExpired(tokenData)
    };
  }

  /**
   * Generate secure state parameter
   */
  private generateState(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Clean up expired state parameters
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    const expiredStates: string[] = [];

    for (const [state, info] of this.pendingStates.entries()) {
      if (now - info.timestamp > this.STATE_TIMEOUT_MS) {
        expiredStates.push(state);
      }
    }

    expiredStates.forEach(state => {
      this.pendingStates.delete(state);
    });

    if (expiredStates.length > 0) {
      console.error(`Cleaned up ${expiredStates.length} expired OAuth states`);
    }
  }

  /**
   * Revoke a specific token
   */
  private async revokeToken(
    token: string,
    clientId: string,
    clientSecret: string,
    instanceUrl: string
  ): Promise<void> {
    const revokeUrl = new URL('/services/oauth2/revoke', instanceUrl);
    
    const requestBody = new URLSearchParams({
      token,
      client_id: clientId,
      client_secret: clientSecret
    }).toString();

    return new Promise((resolve, reject) => {
      const req = require('https').request({
        method: 'POST',
        hostname: revokeUrl.hostname,
        path: revokeUrl.pathname,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      }, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Token revocation failed with status: ${res.statusCode}`));
          }
        });
      });

      req.on('error', (e: Error) => {
        reject(new Error(`Token revocation request error: ${e.message}`));
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * Get statistics about OAuth flows
   */
  getOAuthStats(): {
    pendingStates: number;
    storedTokens: number;
  } {
    this.cleanupExpiredStates();
    
    return {
      pendingStates: this.pendingStates.size,
      storedTokens: tokenManager.getStoredUserIds().length
    };
  }

  /**
   * Cleanup method for graceful shutdown
   */
  cleanup(): void {
    this.pendingStates.clear();
    console.error('PersonalOAuthHandler cleanup completed');
  }
}

// Singleton instance for application-wide use
export const personalOAuthHandler = new PersonalOAuthHandler();