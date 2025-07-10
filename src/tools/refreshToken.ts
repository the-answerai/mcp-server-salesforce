import { Tool } from "@modelcontextprotocol/sdk/types.js";
import https from "https";
import querystring from "querystring";
import { ConnectionError } from "../utils/errorHandler.js";

export const REFRESH_TOKEN: Tool = {
  name: "salesforce_refresh_token",
  description: "Refresh a Salesforce access token using a refresh token",
  inputSchema: {
    type: "object",
    properties: {
      refreshToken: {
        type: "string",
        description: "The refresh token to use for obtaining a new access token"
      },
      instanceUrl: {
        type: "string",
        description: "Optional Salesforce instance URL (defaults to environment variable)"
      }
    },
    required: ["refreshToken"]
  }
};

export async function handleRefreshToken(refreshToken: string, instanceUrl?: string) {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const effectiveInstanceUrl = instanceUrl || process.env.SALESFORCE_INSTANCE_URL || 'https://login.salesforce.com';

  if (!clientId || !clientSecret) {
    throw new ConnectionError(
      'SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET are required for token refresh',
      'MISSING_CLIENT_CREDENTIALS'
    );
  }

  const tokenUrl = new URL('/services/oauth2/token', effectiveInstanceUrl);
  const requestBody = querystring.stringify({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  });

  try {
    const response = await makeTokenRequest(tokenUrl, requestBody);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          access_token: response.access_token,
          token_type: response.token_type,
          instance_url: response.instance_url,
          signature: response.signature,
          issued_at: response.issued_at,
          scope: response.scope,
          refresh_token: response.refresh_token || refreshToken // Use new refresh token if provided, otherwise keep original
        }, null, 2)
      }],
      isError: false,
    };
  } catch (error) {
    throw new ConnectionError(
      `Token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      'TOKEN_REFRESH_FAILED'
    );
  }
}

/**
 * Make HTTP request for token refresh
 */
async function makeTokenRequest(tokenUrl: URL, requestBody: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: tokenUrl.hostname,
        path: tokenUrl.pathname,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsedData = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(
                new Error(`${parsedData.error}: ${parsedData.error_description}`)
              );
            } else {
              resolve(parsedData);
            }
          } catch (e: unknown) {
            reject(
              new Error(
                `Failed to parse token response: ${
                  e instanceof Error ? e.message : String(e)
                }`
              )
            );
          }
        });
      }
    );

    req.on('error', (e) => {
      reject(new Error(`Token request error: ${e.message}`));
    });

    req.write(requestBody);
    req.end();
  });
}