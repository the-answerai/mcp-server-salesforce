import jsforce, { type Connection } from "jsforce";
import { ConnectionType, ConnectionConfig, TokenData, PersonalOAuthConfig } from '../types/connection.js';
import { tokenManager } from './tokenManager.js';
import { isTokenExpiredError, handleConnectionError, ConnectionError } from './errorHandler.js';
import https from 'https';
import querystring from 'querystring';

/**
 * Manages Salesforce connections with pooling, refresh logic, and OAuth support
 */
export class ConnectionManager {
  private connections = new Map<string, any>();
  private connectionPromises = new Map<string, Promise<any>>();
  private readonly DEFAULT_USER_ID = 'default_user';

  /**
   * Get or create a connection for the specified user
   */
  async getConnection(userId?: string, config?: ConnectionConfig): Promise<any> {
    const effectiveUserId = userId || this.DEFAULT_USER_ID;
    const cacheKey = `${effectiveUserId}_${config?.type || ConnectionType.User_Password}`;

    // Check if connection already exists and is valid
    const existingConnection = this.connections.get(cacheKey);
    if (existingConnection && await this.isConnectionValid(existingConnection)) {
      return existingConnection;
    }

    // Check if connection creation is already in progress
    const existingPromise = this.connectionPromises.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    // Create new connection
    const connectionPromise = this.createNewConnection(effectiveUserId, config);
    this.connectionPromises.set(cacheKey, connectionPromise);

    try {
      const connection = await connectionPromise;
      this.connections.set(cacheKey, connection);
      return connection;
    } finally {
      this.connectionPromises.delete(cacheKey);
    }
  }

  /**
   * Refresh a connection's token
   */
  async refreshConnection(userId?: string, config?: ConnectionConfig): Promise<any> {
    const effectiveUserId = userId || this.DEFAULT_USER_ID;
    const cacheKey = `${effectiveUserId}_${config?.type || ConnectionType.User_Password}`;

    // Remove existing connection
    this.connections.delete(cacheKey);

    // Create fresh connection
    return await this.getConnection(effectiveUserId, config);
  }

  /**
   * Execute a function with automatic retry on token expiration
   */
  async executeWithRetry<T>(
    operation: (connection: any) => Promise<T>,
    userId?: string,
    config?: ConnectionConfig,
    maxRetries: number = 1
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const connection = await this.getConnection(userId, config);
        return await operation(connection);
      } catch (error) {
        lastError = error;

        if (isTokenExpiredError(error) && attempt < maxRetries) {
          console.error(`Attempt ${attempt + 1} failed with token error, refreshing connection...`);
          await this.refreshConnection(userId, config);
          continue;
        }

        // If it's not a token error or we've exhausted retries, throw
        break;
      }
    }

    throw lastError;
  }

  /**
   * Create a personal OAuth connection using authorization code
   */
  async createPersonalOAuthConnection(oauthConfig: PersonalOAuthConfig, userId: string): Promise<any> {
    if (!oauthConfig.authorizationCode && !oauthConfig.tokenData) {
      throw new ConnectionError(
        'Either authorization code or existing token data is required for personal OAuth',
        'MISSING_AUTH_DATA'
      );
    }

    let tokenData: TokenData;

    if (oauthConfig.tokenData) {
      // Use existing token data
      tokenData = oauthConfig.tokenData;
    } else if (oauthConfig.authorizationCode) {
      // Exchange authorization code for tokens
      const instanceUrl = process.env.SALESFORCE_INSTANCE_URL || 'https://login.salesforce.com';
      tokenData = await tokenManager.exchangeCodeForTokens(
        oauthConfig.authorizationCode,
        oauthConfig.clientId,
        oauthConfig.clientSecret,
        oauthConfig.redirectUri,
        instanceUrl
      );
    } else {
      throw new ConnectionError('Invalid OAuth configuration', 'INVALID_OAUTH_CONFIG');
    }

    // Store token for future use
    await tokenManager.storeToken(userId, tokenData);

    // Create jsforce connection with refresh capability
    const connection = new jsforce.Connection({
      instanceUrl: tokenData.instanceUrl,
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      oauth2: {
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        redirectUri: oauthConfig.redirectUri
      }
    });

    // Set up automatic token refresh
    this.setupConnectionRefresh(connection, userId, oauthConfig);

    console.error(`Personal OAuth connection created for user: ${userId}`);
    return connection;
  }

  /**
   * Get authorization URL for personal OAuth flow
   */
  getAuthorizationUrl(
    clientId: string,
    redirectUri: string,
    state: string,
    instanceUrl?: string
  ): string {
    const baseUrl = instanceUrl || 'https://login.salesforce.com';
    const authUrl = new URL('/services/oauth2/authorize', baseUrl);
    
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', 'api refresh_token');

    return authUrl.toString();
  }

  /**
   * Clear connection for a user
   */
  clearConnection(userId?: string, connectionType?: ConnectionType): void {
    const effectiveUserId = userId || this.DEFAULT_USER_ID;
    const cacheKey = `${effectiveUserId}_${connectionType || ConnectionType.User_Password}`;
    
    this.connections.delete(cacheKey);
    tokenManager.clearToken(effectiveUserId);
    
    console.error(`Connection cleared for user: ${effectiveUserId}`);
  }

  /**
   * Clear all connections
   */
  clearAllConnections(): void {
    this.connections.clear();
    this.connectionPromises.clear();
    tokenManager.cleanup();
    
    console.error('All connections cleared');
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): { activeConnections: number; storedTokens: number } {
    return {
      activeConnections: this.connections.size,
      storedTokens: tokenManager.getStoredUserIds().length
    };
  }

  /**
   * Create a new connection based on configuration
   */
  private async createNewConnection(userId: string, config?: ConnectionConfig): Promise<any> {
    const connectionType = config?.type || 
      (process.env.SALESFORCE_CONNECTION_TYPE as ConnectionType) || 
      ConnectionType.User_Password;

    const loginUrl = config?.loginUrl || 
      process.env.SALESFORCE_INSTANCE_URL || 
      'https://login.salesforce.com';

    switch (connectionType) {
      case ConnectionType.OAuth_2_0_Personal:
        if (!config?.personalOAuth) {
          throw new ConnectionError('Personal OAuth configuration required', 'MISSING_OAUTH_CONFIG');
        }
        return await this.createPersonalOAuthConnection(config.personalOAuth, userId);

      case ConnectionType.OAuth_2_0_Authorization_Code:
        if (!config?.tokenData) {
          throw new ConnectionError('Token data required for authorization code flow', 'MISSING_TOKEN_DATA');
        }
        return await this.createTokenBasedConnection(config.tokenData, userId);

      case ConnectionType.OAuth_2_0_Client_Credentials:
        return await this.createClientCredentialsConnection(loginUrl);

      case ConnectionType.User_Password:
      default:
        return await this.createUsernamePasswordConnection(loginUrl);
    }
  }

  /**
   * Create connection using username/password
   */
  private async createUsernamePasswordConnection(loginUrl: string): Promise<any> {
    const username = process.env.SALESFORCE_USERNAME;
    const password = process.env.SALESFORCE_PASSWORD;
    const token = process.env.SALESFORCE_TOKEN;

    if (!username || !password) {
      throw new ConnectionError(
        'SALESFORCE_USERNAME and SALESFORCE_PASSWORD are required for Username/Password authentication',
        'MISSING_CREDENTIALS'
      );
    }

    console.error('Creating Username/Password connection...');

    const connection = new jsforce.Connection({ loginUrl });
    await connection.login(username, password + (token || ''));

    console.error('Username/Password connection established');
    return connection;
  }

  /**
   * Create connection using OAuth 2.0 Client Credentials
   */
  private async createClientCredentialsConnection(instanceUrl: string): Promise<any> {
    const clientId = process.env.SALESFORCE_CLIENT_ID;
    const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new ConnectionError(
        'SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET are required for OAuth 2.0 Client Credentials Flow',
        'MISSING_CLIENT_CREDENTIALS'
      );
    }

    console.error('Creating OAuth 2.0 Client Credentials connection...');

    const tokenUrl = new URL('/services/oauth2/token', instanceUrl);
    const requestBody = querystring.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    });

    const tokenResponse = await this.makeTokenRequest(tokenUrl, requestBody);

    const connection = new jsforce.Connection({
      instanceUrl: tokenResponse.instance_url,
      accessToken: tokenResponse.access_token
    });

    console.error('OAuth 2.0 Client Credentials connection established');
    return connection;
  }

  /**
   * Create connection using existing token data
   */
  private async createTokenBasedConnection(tokenData: TokenData, userId: string): Promise<any> {
    // Check if token is expired
    if (tokenManager.isTokenExpired(tokenData)) {
      throw new ConnectionError('Token is expired', 'TOKEN_EXPIRED', true);
    }

    console.error(`Creating token-based connection for user: ${userId}`);

    // Create connection config
    const connectionConfig: any = {
      instanceUrl: tokenData.instanceUrl,
      accessToken: tokenData.accessToken
    };

    // If we have a refresh token, we need to include OAuth2 client info
    if (tokenData.refreshToken) {
      const clientId = process.env.SALESFORCE_CLIENT_ID;
      const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
      const redirectUri = process.env.SALESFORCE_REDIRECT_URI;

      if (clientId && clientSecret) {
        connectionConfig.refreshToken = tokenData.refreshToken;
        connectionConfig.oauth2 = {
          clientId: clientId,
          clientSecret: clientSecret,
          redirectUri: redirectUri || 'https://login.salesforce.com/services/oauth2/callback'
        };
      } else {
        console.warn('Refresh token available but OAuth2 client credentials not found. Refresh functionality will be limited.');
      }
    }

    const connection = new jsforce.Connection(connectionConfig);

    // Store token for management
    await tokenManager.storeToken(userId, tokenData);

    console.error('Token-based connection established');
    return connection;
  }

  /**
   * Set up automatic token refresh for a connection
   */
  private setupConnectionRefresh(
    connection: any,
    userId: string,
    oauthConfig: PersonalOAuthConfig
  ): void {
    // Set up refresh function
    if (connection.oauth2) {
      connection.oauth2.refreshToken = async (refreshToken: string) => {
        try {
          const newTokenData = await tokenManager.refreshToken(
            userId,
            oauthConfig.clientId,
            oauthConfig.clientSecret,
            connection.instanceUrl || 'https://login.salesforce.com'
          );

          // Update connection with new token
          connection.accessToken = newTokenData.accessToken;
          connection.refreshToken = newTokenData.refreshToken;

          console.error(`Token refreshed automatically for user: ${userId}`);
          return {
            access_token: newTokenData.accessToken,
            refresh_token: newTokenData.refreshToken,
            instance_url: newTokenData.instanceUrl
          };
        } catch (error) {
          console.error(`Automatic token refresh failed for user: ${userId}`, error);
          throw error;
        }
      };
    }
  }

  /**
   * Check if connection is valid and active
   */
  private async isConnectionValid(connection: any): Promise<boolean> {
    try {
      // Quick validation by querying user info
      await connection.query('SELECT Id FROM User LIMIT 1');
      return true;
    } catch (error) {
      if (isTokenExpiredError(error)) {
        return false;
      }
      // For other errors, assume connection is still valid but there's a different issue
      return true;
    }
  }

  /**
   * Make HTTP request for token operations
   */
  private async makeTokenRequest(tokenUrl: URL, requestBody: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = https.request({
        method: 'POST',
        hostname: tokenUrl.hostname,
        path: tokenUrl.pathname,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsedData = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new ConnectionError(
                `Token request failed: ${parsedData.error} - ${parsedData.error_description}`,
                'TOKEN_REQUEST_FAILED'
              ));
            } else {
              resolve(parsedData);
            }
          } catch (e: unknown) {
            reject(new ConnectionError(
              `Failed to parse token response: ${e instanceof Error ? e.message : String(e)}`,
              'TOKEN_PARSE_ERROR'
            ));
          }
        });
      });

      req.on('error', (e) => {
        reject(new ConnectionError(`Token request error: ${e.message}`, 'NETWORK_ERROR'));
      });

      req.write(requestBody);
      req.end();
    });
  }
}

// Singleton instance for application-wide use
export const connectionManager = new ConnectionManager();