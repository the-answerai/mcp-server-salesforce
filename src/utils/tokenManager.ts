import { TokenData } from '../types/connection.js';
import https from 'https';
import querystring from 'querystring';

/**
 * Token refresh buffer time - refresh 5 minutes before expiry
 */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Check if token is expired or will expire soon
 */
export function isTokenExpired(tokenData: TokenData): boolean {
  if (!tokenData.expiresAt) {
    return false; // No expiration info, assume valid
  }

  const now = new Date();
  const expiryWithBuffer = new Date(tokenData.expiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS);
  
  return now >= expiryWithBuffer;
}

/**
 * Refresh an OAuth token using refresh token
 */
export async function refreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  instanceUrl: string
): Promise<TokenData> {
  if (!refreshToken) {
    throw new Error('No refresh token provided');
  }

  try {
    const tokenUrl = new URL('/services/oauth2/token', instanceUrl);
    
    const requestBody = querystring.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    });

    const tokenResponse = await makeTokenRequest(tokenUrl, requestBody);
    
    const newTokenData: TokenData = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token || refreshToken,
      instanceUrl: tokenResponse.instance_url || instanceUrl,
      scope: tokenResponse.scope,
      tokenType: tokenResponse.token_type || 'Bearer',
      expiresAt: tokenResponse.expires_in ? 
        new Date(Date.now() + (tokenResponse.expires_in * 1000)) : undefined
    };

    console.error('Token refreshed successfully');
    return newTokenData;
  } catch (error) {
    console.error('Token refresh failed:', error);
    throw new Error(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
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

    const tokenResponse = await makeTokenRequest(tokenUrl, requestBody);
    
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
 * Make HTTP request for token operations
 */
async function makeTokenRequest(tokenUrl: URL, requestBody: string): Promise<any> {
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