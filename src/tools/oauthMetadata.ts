import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const GET_OAUTH_METADATA: Tool = {
  name: "get_oauth_metadata",
  description: "Returns OAuth 2.0 Authorization Server Metadata for Salesforce authentication. After user authorizes, the redirect URL will contain both access_token and refresh_token in the URL fragment (hash). Instruct the user to copy the entire redirect URL and extract both tokens from it. The access_token can be used immediately with Salesforce tools, and the refresh_token can be used with the salesforce_refresh_token tool when the access token expires.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

export async function handleGetOAuthMetadata() {
  const instanceUrl = process.env.SALESFORCE_INSTANCE_URL || 'https://login.salesforce.com';
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const redirectUri = process.env.SALESFORCE_REDIRECT_URI || 'https://login.salesforce.com/services/oauth2/callback';

  const metadata = {
    issuer: instanceUrl,
    authorization_endpoint: `${instanceUrl}/services/oauth2/authorize`,
    token_endpoint: `${instanceUrl}/services/oauth2/token`,
    revocation_endpoint: `${instanceUrl}/services/oauth2/revoke`,
    scopes_supported: ["id", "api", "refresh_token", "web", "full"],
    response_types_supported: ["token"],
    grant_types_supported: ["implicit"],
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "token",
    scope: "api id refresh_token"
  };

  return {
    content: [{
      type: "text",
      text: JSON.stringify(metadata, null, 2)
    }],
    isError: false,
  };
}