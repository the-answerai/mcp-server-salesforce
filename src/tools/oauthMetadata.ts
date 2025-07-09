import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const GET_OAUTH_METADATA: Tool = {
  name: "get_oauth_metadata",
  description: "Returns OAuth 2.0 Authorization Server Metadata for Salesforce authentication",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

export async function handleGetOAuthMetadata() {
  const instanceUrl = process.env.SALESFORCE_INSTANCE_URL || 'https://login.salesforce.com';
  const clientId = process.env.SALESFORCE_CLIENT_ID;

  const metadata = {
    issuer: instanceUrl,
    authorization_endpoint: `${instanceUrl}/services/oauth2/authorize`,
    token_endpoint: `${instanceUrl}/services/oauth2/token`,
    revocation_endpoint: `${instanceUrl}/services/oauth2/revoke`,
    scopes_supported: ["id", "api", "refresh_token", "web", "full"],
    response_types_supported: ["code", "token"],
    grant_types_supported: ["authorization_code", "implicit", "refresh_token", "client_credentials"],
    code_challenge_methods_supported: ["S256"],
    client_id: clientId
  };

  return {
    content: [{
      type: "text",
      text: JSON.stringify(metadata, null, 2)
    }],
    isError: false,
  };
}