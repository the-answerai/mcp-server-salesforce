import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ConnectionError } from "../utils/errorHandler.js";
import { refreshToken } from "../utils/tokenManager.js";

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

export async function handleRefreshToken(refreshTokenValue: string, instanceUrl?: string) {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
  const effectiveInstanceUrl = instanceUrl || process.env.SALESFORCE_INSTANCE_URL || 'https://login.salesforce.com';

  if (!clientId || !clientSecret) {
    throw new ConnectionError(
      'SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET are required for token refresh',
      'MISSING_CLIENT_CREDENTIALS'
    );
  }

  try {
    const tokenData = await refreshToken(
      refreshTokenValue,
      clientId,
      clientSecret,
      effectiveInstanceUrl
    );
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          access_token: tokenData.accessToken,
          token_type: tokenData.tokenType,
          instance_url: tokenData.instanceUrl,
          scope: tokenData.scope,
          refresh_token: tokenData.refreshToken,
          expires_at: tokenData.expiresAt?.toISOString()
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

