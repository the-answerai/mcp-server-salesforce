import { TokenData } from '../types/connection.js';
import https from 'https';
import querystring from 'querystring';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Manages OAuth token lifecycle including storage, refresh, and expiration handling
 */
export class TokenManager {
  private tokens = new Map<string, TokenData>();
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private tokenFile: string;

  constructor() {
    // Store tokens in ~/.config/mcp-server-salesforce/tokens.json
    const configDir = path.join(os.homedir(), '.config', 'mcp-server-salesforce');
    this.tokenFile = path.join(configDir, 'tokens.json');
    
    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 }); // Only user readable/writable
    }
    
    // Load existing tokens on startup
    this.loadTokensFromFile();
  }

  /**
   * Load tokens from persistent storage
   */
  private loadTokensFromFile(): void {
    try {
      if (fs.existsSync(this.tokenFile)) {
        const data = fs.readFileSync(this.tokenFile, 'utf8');
        const tokenData = JSON.parse(data);
        
        // Convert stored data back to TokenData objects
        for (const [userId, token] of Object.entries(tokenData)) {
          const tokenObj = token as any;
          // Convert expiresAt back to Date object if it exists
          if (tokenObj.expiresAt) {
            tokenObj.expiresAt = new Date(tokenObj.expiresAt);
          }
          this.tokens.set(userId, tokenObj as TokenData);
        }
        
        console.error(`Loaded ${this.tokens.size} stored tokens from ${this.tokenFile}`);
      }
    } catch (error) {
      console.error('Failed to load tokens from file:', error);
      // Continue with empty tokens if file is corrupted
    }
  }

  /**
   * Save tokens to persistent storage
   */
  private saveTokensToFile(): void {
    try {
      const tokenData: Record<string, any> = {};
      
      for (const [userId, token] of this.tokens.entries()) {
        tokenData[userId] = {
          ...token,
          // Convert Date objects to strings for JSON storage
          expiresAt: token.expiresAt?.toISOString()
        };
      }
      
      fs.writeFileSync(this.tokenFile, JSON.stringify(tokenData, null, 2), { 
        mode: 0o600 // Only user readable/writable
      });
      
      console.error(`Saved ${this.tokens.size} tokens to ${this.tokenFile}`);
    } catch (error) {
      console.error('Failed to save tokens to file:', error);
    }
  }
  private readonly TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry

  /**
   * Store token data for a user
   */
  async storeToken(userId: string, tokenData: TokenData): Promise<void> {
    console.error(`STORING TOKEN for user: ${userId}`);
    console.error(`Token data: ${JSON.stringify(tokenData, null, 2)}`);
    
    this.tokens.set(userId, { ...tokenData, userId });
    
    // Schedule automatic refresh if expiration is known
    if (tokenData.expiresAt) {
      this.scheduleTokenRefresh(userId, tokenData.expiresAt);
    }
    
    // Persist to disk
    console.error(`About to save tokens to file: ${this.tokenFile}`);
    this.saveTokensToFile();
    
    console.error(`Token stored for user: ${userId}`);
  }

  /**
   * Retrieve token data for a user
   */
  async getToken(userId: string): Promise<TokenData | null> {
    const tokenData = this.tokens.get(userId);
    
    if (!tokenData) {
      return null;
    }

    // Check if token is expired
    if (this.isTokenExpired(tokenData)) {
      console.error(`Token expired for user: ${userId}`);
      return null;
    }

    return tokenData;
  }

  /**
   * Refresh an OAuth token using refresh token
   */
  async refreshToken(userId: string, clientId: string, clientSecret: string, instanceUrl: string): Promise<TokenData> {
    const currentToken = this.tokens.get(userId);
    
    if (!currentToken?.refreshToken) {
      throw new Error(`No refresh token available for user: ${userId}`);
    }

    try {
      const tokenUrl = new URL('/services/oauth2/token', instanceUrl);
      
      const requestBody = querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token: currentToken.refreshToken,
        client_id: clientId,
        client_secret: clientSecret
      });

      const tokenResponse = await this.makeTokenRequest(tokenUrl, requestBody);
      
      const newTokenData: TokenData = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token || currentToken.refreshToken,
        instanceUrl: tokenResponse.instance_url || instanceUrl,
        scope: tokenResponse.scope,
        tokenType: tokenResponse.token_type || 'Bearer',
        userId,
        expiresAt: tokenResponse.expires_in ? 
          new Date(Date.now() + (tokenResponse.expires_in * 1000)) : undefined
      };

      await this.storeToken(userId, newTokenData);
      console.error(`Token refreshed successfully for user: ${userId}`);
      
      return newTokenData;
    } catch (error) {
      console.error(`Token refresh failed for user: ${userId}`, error);
      // Clear invalid token
      this.clearToken(userId);
      throw new Error(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(
    authorizationCode: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    instanceUrl: string
  ): Promise<TokenData> {
    try {
      const tokenUrl = new URL('/services/oauth2/token', instanceUrl);
      
      const requestBody = querystring.stringify({
        grant_type: 'authorization_code',
        code: authorizationCode,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      });

      const tokenResponse = await this.makeTokenRequest(tokenUrl, requestBody);
      
      const tokenData: TokenData = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        instanceUrl: tokenResponse.instance_url || instanceUrl,
        scope: tokenResponse.scope,
        tokenType: tokenResponse.token_type || 'Bearer',
        expiresAt: tokenResponse.expires_in ? 
          new Date(Date.now() + (tokenResponse.expires_in * 1000)) : undefined
      };

      console.error('Authorization code exchanged successfully');
      return tokenData;
    } catch (error) {
      console.error('Authorization code exchange failed:', error);
      throw new Error(`Code exchange failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if token is expired or will expire soon
   */
  isTokenExpired(tokenData: TokenData): boolean {
    if (!tokenData.expiresAt) {
      return false; // No expiration info, assume valid
    }

    const now = new Date();
    const expiryWithBuffer = new Date(tokenData.expiresAt.getTime() - this.TOKEN_REFRESH_BUFFER_MS);
    
    return now >= expiryWithBuffer;
  }

  /**
   * Clear token for a user
   */
  clearToken(userId: string): void {
    this.tokens.delete(userId);
    
    // Clear any scheduled refresh
    const timer = this.refreshTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(userId);
    }
    
    // Persist to disk
    this.saveTokensToFile();
    
    console.error(`Token cleared for user: ${userId}`);
  }

  /**
   * Clear all expired tokens
   */
  async clearExpiredTokens(): Promise<void> {
    const expiredUsers: string[] = [];
    
    for (const [userId, tokenData] of this.tokens.entries()) {
      if (this.isTokenExpired(tokenData)) {
        expiredUsers.push(userId);
      }
    }
    
    expiredUsers.forEach(userId => this.clearToken(userId));
    
    if (expiredUsers.length > 0) {
      console.error(`Cleared ${expiredUsers.length} expired tokens`);
    }
  }

  /**
   * Get all stored user IDs
   */
  getStoredUserIds(): string[] {
    return Array.from(this.tokens.keys());
  }

  /**
   * Schedule automatic token refresh
   */
  private scheduleTokenRefresh(userId: string, expiresAt: Date): void {
    // Clear existing timer
    const existingTimer = this.refreshTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Calculate when to refresh (5 minutes before expiry)
    const refreshTime = expiresAt.getTime() - Date.now() - this.TOKEN_REFRESH_BUFFER_MS;
    
    if (refreshTime > 0) {
      const timer = setTimeout(() => {
        console.error(`Auto-refresh triggered for user: ${userId}`);
        // Note: Auto-refresh would need client credentials, which should be injected
        // For now, just clear the token to force re-authentication
        this.clearToken(userId);
      }, refreshTime);
      
      this.refreshTimers.set(userId, timer);
      console.error(`Token refresh scheduled for user: ${userId} in ${Math.round(refreshTime / 1000)}s`);
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
              reject(new Error(`Token request failed: ${parsedData.error} - ${parsedData.error_description}`));
            } else {
              resolve(parsedData);
            }
          } catch (e: unknown) {
            reject(new Error(`Failed to parse token response: ${e instanceof Error ? e.message : String(e)}`));
          }
        });
      });
      
      req.on('error', (e) => {
        reject(new Error(`Token request error: ${e.message}`));
      });
      
      req.write(requestBody);
      req.end();
    });
  }

  /**
   * Cleanup method to clear all timers and tokens
   */
  cleanup(): void {
    // Clear all refresh timers
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    
    // Clear all tokens
    this.tokens.clear();
    
    // Persist to disk
    this.saveTokensToFile();
    
    console.error('TokenManager cleanup completed');
  }
}

// Singleton instance for application-wide use
export const tokenManager = new TokenManager();