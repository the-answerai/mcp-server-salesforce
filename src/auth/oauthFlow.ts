import { TokenData, PersonalOAuthConfig } from '../types/connection.js';
import { tokenManager } from '../utils/tokenManager.js';
import { ConnectionError } from '../utils/errorHandler.js';
import { getUserInfo, generateUserId } from '../utils/userInfo.js';
import jsforce from 'jsforce';
import crypto from 'crypto';

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
 * Stateless OAuth 2.0 authorization flow handler for Salesforce
 */
export class PersonalOAuthHandler {
  constructor() {
    // Stateless OAuth handler - client manages state
  }

  /**
   * Generate authorization URL for OAuth flow
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
   * Handle OAuth implicit flow callback (when access_token is provided directly)
   */
  async handleImplicitCallback(
    accessToken: string
  ): Promise<{ tokenData: TokenData; userId: string; userInfo: any }> {
    try {
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
      console.error(`OAuth implicit callback processing failed`, error);
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
      console.error(`OAuth callback processing failed`, error);
      throw new ConnectionError(
        `Failed to exchange authorization code: ${error instanceof Error ? error.message : String(error)}`,
        'CODE_EXCHANGE_FAILED'
      );
    }
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
}

// Singleton instance for application-wide use
export const personalOAuthHandler = new PersonalOAuthHandler();