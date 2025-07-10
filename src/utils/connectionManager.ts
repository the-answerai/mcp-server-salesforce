import jsforce, { type Connection } from "jsforce";
import {
  ConnectionType,
  ConnectionConfig,
  TokenData,
  PersonalOAuthConfig,
} from "../types/connection.js";
import { isTokenExpired, exchangeCodeForTokens, refreshToken } from "./tokenManager.js";
import {
  isTokenExpiredError,
  handleConnectionError,
  ConnectionError,
} from "./errorHandler.js";

/**
 * Options for executeWithRetry method
 */
export interface ExecuteWithRetryOptions {
  userId?: string;
  config?: ConnectionConfig;
  maxRetries?: number;
}

/**
 * Cached token data for personal OAuth
 */
interface CachedToken {
  accessToken: string;
  expiresAt: Date;
  refreshToken?: string;
}
import https from "https";
import querystring from "querystring";

/**
 * Manages Salesforce connections with pooling, refresh logic, and OAuth support
 */
export class ConnectionManager {
  private connections = new Map<string, any>();
  private connectionPromises = new Map<string, Promise<any>>();
  private tokenCache = new Map<string, CachedToken>();
  private readonly DEFAULT_USER_ID = "default_user";

  /**
   * Get or create a connection for the specified user
   */
  async getConnection(
    userIdOrAccessToken?: string,
    config?: ConnectionConfig
  ): Promise<any> {
    // If the first parameter looks like an access token, use it directly
    if (userIdOrAccessToken && this.isAccessToken(userIdOrAccessToken)) {
      return await this.createDirectAccessTokenConnection(userIdOrAccessToken);
    }

    const userId = userIdOrAccessToken;
    const effectiveUserId = userId || this.DEFAULT_USER_ID;
    const cacheKey = `${effectiveUserId}_${
      config?.type || ConnectionType.User_Password
    }`;

    // Check if connection already exists and is valid
    const existingConnection = this.connections.get(cacheKey);
    if (
      existingConnection &&
      (await this.isConnectionValid(existingConnection))
    ) {
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
  async refreshConnection(
    userId?: string,
    config?: ConnectionConfig
  ): Promise<any> {
    const effectiveUserId = userId || this.DEFAULT_USER_ID;
    const cacheKey = `${effectiveUserId}_${
      config?.type || ConnectionType.User_Password
    }`;

    // Remove existing connection
    this.connections.delete(cacheKey);
    
    // Clear cached tokens for personal OAuth
    if (config?.type === ConnectionType.OAuth_2_0_Personal) {
      this.clearCachedTokens(effectiveUserId);
    }

    // Create fresh connection
    return await this.getConnection(effectiveUserId, config);
  }

  /**
   * Execute a function with automatic retry on token expiration
   */
  async executeWithRetry<T>(
    operation: (connection: any) => Promise<T>,
    options: ExecuteWithRetryOptions = {}
  ): Promise<T> {
    const { userId, config, maxRetries = 1 } = options;

    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const connection = await this.getConnection(userId, config);
        return await operation(connection);
      } catch (error) {
        lastError = error;

        if (isTokenExpiredError(error) && attempt < maxRetries) {
          console.error(
            `Attempt ${
              attempt + 1
            } failed with token error, refreshing connection...`
          );
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
  async createPersonalOAuthConnection(
    oauthConfig: PersonalOAuthConfig,
    userId: string
  ): Promise<any> {
    if (!oauthConfig.authorizationCode && !oauthConfig.tokenData) {
      throw new ConnectionError(
        "Either authorization code or existing token data is required for personal OAuth",
        "MISSING_AUTH_DATA"
      );
    }

    let tokenData: TokenData;

    if (oauthConfig.tokenData) {
      // Use existing token data
      tokenData = oauthConfig.tokenData;
    } else if (oauthConfig.authorizationCode) {
      // Exchange authorization code for tokens
      const instanceUrl =
        process.env.SALESFORCE_INSTANCE_URL || "https://login.salesforce.com";
      tokenData = await exchangeCodeForTokens(
        oauthConfig.authorizationCode,
        oauthConfig.clientId,
        oauthConfig.clientSecret,
        oauthConfig.redirectUri,
        instanceUrl
      );
    } else {
      throw new ConnectionError(
        "Invalid OAuth configuration",
        "INVALID_OAUTH_CONFIG"
      );
    }


    // Create jsforce connection with refresh capability
    const connection = new jsforce.Connection({
      instanceUrl: tokenData.instanceUrl,
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      oauth2: {
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        redirectUri: oauthConfig.redirectUri,
      },
    });

    // Set up automatic token refresh
    this.setupConnectionRefresh(connection, userId, oauthConfig);

    console.error(`Personal OAuth connection created for user: ${userId}`);
    return connection;
  }


  /**
   * Clear connection for a user
   */
  clearConnection(userId?: string, connectionType?: ConnectionType): void {
    const effectiveUserId = userId || this.DEFAULT_USER_ID;
    const cacheKey = `${effectiveUserId}_${
      connectionType || ConnectionType.User_Password
    }`;

    this.connections.delete(cacheKey);

    console.error(`Connection cleared for user: ${effectiveUserId}`);
  }

  /**
   * Clear all connections
   */
  clearAllConnections(): void {
    this.connections.clear();
    this.connectionPromises.clear();

    console.error("All connections cleared");
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): { activeConnections: number } {
    return {
      activeConnections: this.connections.size,
    };
  }

  /**
   * Create a new connection based on configuration
   */
  private async createNewConnection(
    userId: string,
    config?: ConnectionConfig
  ): Promise<any> {
    const connectionType =
      config?.type ||
      (process.env.SALESFORCE_CONNECTION_TYPE as ConnectionType) ||
      ConnectionType.User_Password;

    const loginUrl =
      config?.loginUrl ||
      process.env.SALESFORCE_INSTANCE_URL ||
      "https://login.salesforce.com";

    switch (connectionType) {
      case ConnectionType.OAuth_2_0_Personal:
        return await this.createPersonalOAuthConnectionFromEnv(userId);

      case ConnectionType.OAuth_2_0_Authorization_Code:
        if (!config?.tokenData) {
          throw new ConnectionError(
            "Token data required for authorization code flow",
            "MISSING_TOKEN_DATA"
          );
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
  private async createUsernamePasswordConnection(
    loginUrl: string
  ): Promise<any> {
    const username = process.env.SALESFORCE_USERNAME;
    const password = process.env.SALESFORCE_PASSWORD;
    const token = process.env.SALESFORCE_TOKEN;

    if (!username || !password) {
      throw new ConnectionError(
        "SALESFORCE_USERNAME and SALESFORCE_PASSWORD are required for Username/Password authentication",
        "MISSING_CREDENTIALS"
      );
    }

    console.error("Creating Username/Password connection...");

    const connection = new jsforce.Connection({ loginUrl });
    await connection.login(username, password + (token || ""));

    console.error("Username/Password connection established");
    return connection;
  }

  /**
   * Create connection using OAuth 2.0 Client Credentials
   */
  private async createClientCredentialsConnection(
    instanceUrl: string
  ): Promise<any> {
    const clientId = process.env.SALESFORCE_CLIENT_ID;
    const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new ConnectionError(
        "SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET are required for OAuth 2.0 Client Credentials Flow",
        "MISSING_CLIENT_CREDENTIALS"
      );
    }

    console.error("Creating OAuth 2.0 Client Credentials connection...");

    const tokenUrl = new URL("/services/oauth2/token", instanceUrl);
    const requestBody = querystring.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenResponse = await this.makeTokenRequest(tokenUrl, requestBody);

    const connection = new jsforce.Connection({
      instanceUrl: tokenResponse.instance_url,
      accessToken: tokenResponse.access_token,
    });

    console.error("OAuth 2.0 Client Credentials connection established");
    return connection;
  }

  /**
   * Create connection using existing token data
   */
  private async createTokenBasedConnection(
    tokenData: TokenData,
    userId: string
  ): Promise<any> {
    // Check if token is expired
    if (isTokenExpired(tokenData)) {
      throw new ConnectionError("Token is expired", "TOKEN_EXPIRED", true);
    }

    console.error(`Creating token-based connection for user: ${userId}`);

    // Create connection config
    const connectionConfig: any = {
      instanceUrl: tokenData.instanceUrl,
      accessToken: tokenData.accessToken,
    };

    // If we have a refresh token, we need to include OAuth2 client info
    if (tokenData.refreshToken) {
      const clientId = process.env.SALESFORCE_CLIENT_ID;
      const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

      if (clientId && clientSecret) {
        connectionConfig.refreshToken = tokenData.refreshToken;
        connectionConfig.oauth2 = {
          clientId: clientId,
          clientSecret: clientSecret,
          redirectUri: "https://login.salesforce.com/services/oauth2/callback", // Default callback (not used for refresh)
        };
      } else {
        console.warn(
          "Refresh token available but OAuth2 client credentials not found. Refresh functionality will be limited."
        );
      }
    }

    const connection = new jsforce.Connection(connectionConfig);


    console.error("Token-based connection established");
    return connection;
  }

  /**
   * Create connection using direct access token (for MCP personal OAuth)
   */
  private async createDirectAccessTokenConnection(
    accessToken: string
  ): Promise<any> {
    const instanceUrl =
      process.env.SALESFORCE_INSTANCE_URL || "https://login.salesforce.com";

    // Validate access token format
    if (
      !accessToken ||
      typeof accessToken !== "string" ||
      accessToken.length < 10
    ) {
      throw new ConnectionError(
        "Invalid access token format provided",
        "INVALID_ACCESS_TOKEN"
      );
    }

    const connection = new jsforce.Connection({
      instanceUrl: instanceUrl,
      accessToken: decodeURIComponent(accessToken.trim()), // URL decode and remove whitespace
    });

    return connection;
  }

  /**
   * Check if string looks like an access token
   */
  private isAccessToken(token: string): boolean {
    // Salesforce access tokens typically start with '00D' (session ID format)
    // or are longer JWT-like strings
    return (
      token.length > 20 && (token.startsWith("00D") || token.includes("."))
    );
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
      connection.oauth2.refreshToken = async (refreshTokenValue: string) => {
        try {
          const newTokenData = await refreshToken(
            refreshTokenValue,
            oauthConfig.clientId,
            oauthConfig.clientSecret,
            connection.instanceUrl || "https://login.salesforce.com"
          );

          // Update connection with new token
          connection.accessToken = newTokenData.accessToken;
          connection.refreshToken = newTokenData.refreshToken;

          console.error(`Token refreshed automatically for user: ${userId}`);
          return {
            access_token: newTokenData.accessToken,
            refresh_token: newTokenData.refreshToken,
            instance_url: newTokenData.instanceUrl,
          };
        } catch (error) {
          console.error(
            `Automatic token refresh failed for user: ${userId}`,
            error
          );
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
      await connection.query("SELECT Id FROM User LIMIT 1");
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
  private async makeTokenRequest(
    tokenUrl: URL,
    requestBody: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          method: "POST",
          hostname: tokenUrl.hostname,
          path: tokenUrl.pathname,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(requestBody),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              const parsedData = JSON.parse(data);
              if (res.statusCode !== 200) {
                reject(
                  new ConnectionError(
                    `Token request failed: ${parsedData.error} - ${parsedData.error_description}`,
                    "TOKEN_REQUEST_FAILED"
                  )
                );
              } else {
                resolve(parsedData);
              }
            } catch (e: unknown) {
              reject(
                new ConnectionError(
                  `Failed to parse token response: ${
                    e instanceof Error ? e.message : String(e)
                  }`,
                  "TOKEN_PARSE_ERROR"
                )
              );
            }
          });
        }
      );

      req.on("error", (e) => {
        reject(
          new ConnectionError(
            `Token request error: ${e.message}`,
            "NETWORK_ERROR"
          )
        );
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * Create personal OAuth connection using environment variables and token caching
   */
  private async createPersonalOAuthConnectionFromEnv(userId: string): Promise<any> {
    const clientId = process.env.SALESFORCE_CLIENT_ID;
    const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
    const refreshTokenValue = process.env.SALESFORCE_REFRESH_TOKEN;
    const instanceUrl = process.env.SALESFORCE_INSTANCE_URL || "https://login.salesforce.com";

    if (!clientId || !clientSecret || !refreshTokenValue) {
      throw new ConnectionError(
        "SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, and SALESFORCE_REFRESH_TOKEN are required for personal OAuth",
        "MISSING_OAUTH_ENV_VARS"
      );
    }

    // Check for cached valid token
    const cacheKey = `personal_oauth_${userId}`;
    const cachedToken = this.tokenCache.get(cacheKey);
    
    if (cachedToken && !this.isTokenExpiredSoon(cachedToken)) {
      console.error(`Using cached access token for user: ${userId}`);
      return new jsforce.Connection({
        instanceUrl: instanceUrl,
        accessToken: cachedToken.accessToken,
      });
    }

    // Refresh token to get new access token
    console.error(`Refreshing access token for user: ${userId}`);
    const tokenData = await refreshToken(
      refreshTokenValue,
      clientId,
      clientSecret,
      instanceUrl
    );

    // Cache the new token
    this.tokenCache.set(cacheKey, {
      accessToken: tokenData.accessToken,
      expiresAt: tokenData.expiresAt || new Date(Date.now() + 3600 * 1000), // Default 1 hour
      refreshToken: tokenData.refreshToken || refreshTokenValue,
    });

    const connection = new jsforce.Connection({
      instanceUrl: tokenData.instanceUrl,
      accessToken: tokenData.accessToken,
    });

    console.error(`Personal OAuth connection created for user: ${userId}`);
    return connection;
  }

  /**
   * Check if token is expired or will expire soon (5 minute buffer)
   */
  private isTokenExpiredSoon(cachedToken: CachedToken): boolean {
    const now = new Date();
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    return now >= new Date(cachedToken.expiresAt.getTime() - bufferMs);
  }

  /**
   * Clear cached tokens for a user
   */
  private clearCachedTokens(userId?: string): void {
    if (userId) {
      const cacheKey = `personal_oauth_${userId}`;
      this.tokenCache.delete(cacheKey);
    } else {
      this.tokenCache.clear();
    }
  }
}

// Singleton instance for application-wide use
export const connectionManager = new ConnectionManager();
