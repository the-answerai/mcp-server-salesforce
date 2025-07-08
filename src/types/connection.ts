/**
 * Enum representing the available Salesforce connection types
 */
export enum ConnectionType {
  /**
   * Standard username/password authentication with security token
   * Requires SALESFORCE_USERNAME, SALESFORCE_PASSWORD, and optionally SALESFORCE_TOKEN
   */
  User_Password = 'User_Password',
  
  /**
   * OAuth 2.0 Client Credentials Flow using client ID and secret
   * Requires SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET
   */
  OAuth_2_0_Client_Credentials = 'OAuth_2.0_Client_Credentials',
  
  /**
   * OAuth 2.0 Authorization Code Flow for personal authentication
   * Requires authorization code exchange and supports refresh tokens
   */
  OAuth_2_0_Authorization_Code = 'OAuth_2.0_Authorization_Code',
  
  /**
   * Personal OAuth using stored refresh tokens
   * For user-specific authentication with token persistence
   */
  OAuth_2_0_Personal = 'OAuth_2.0_Personal'
}

/**
 * Token data structure for OAuth flows
 */
export interface TokenData {
  /** Access token for API calls */
  accessToken: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken?: string;
  /** Salesforce instance URL */
  instanceUrl: string;
  /** Token expiration timestamp */
  expiresAt?: Date;
  /** OAuth scope granted */
  scope?: string;
  /** Token type (usually 'Bearer') */
  tokenType?: string;
  /** User identifier for token association */
  userId?: string;
}

/**
 * Personal OAuth configuration
 */
export interface PersonalOAuthConfig {
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret */
  clientSecret: string;
  /** Redirect URI for authorization flow */
  redirectUri: string;
  /** Authorization code from callback */
  authorizationCode?: string;
  /** Stored token data */
  tokenData?: TokenData;
}

/**
 * Configuration options for Salesforce connection
 */
export interface ConnectionConfig {
  /**
   * The type of connection to use
   * @default ConnectionType.User_Password
   */
  type?: ConnectionType;
  
  /**
   * The login URL for Salesforce instance
   * @default 'https://login.salesforce.com'
   */
  loginUrl?: string;
  
  /**
   * Pre-existing token data for OAuth flows
   */
  tokenData?: TokenData;
  
  /**
   * Enable automatic token refresh
   * @default true
   */
  autoRefresh?: boolean;
  
  /**
   * Callback for token refresh events
   */
  onTokenRefresh?: (tokenData: TokenData) => void;
  
  /**
   * Personal OAuth configuration
   */
  personalOAuth?: PersonalOAuthConfig;
  
  /**
   * User identifier for connection association
   */
  userId?: string;
}
