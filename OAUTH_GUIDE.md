# 🔐 OAuth Implementation Guide

## Overview

The Salesforce MCP Server implements the **MCP OAuth 2.1 standard** with robust token management, automatic refresh, and personal authentication flows. This guide covers setup, usage, and testing with MCP clients like MCP Inspector.

## 🚀 Features Implemented

### ✅ **MCP OAuth 2.1 Standard Compliance**
- OAuth discovery document at `/.well-known/oauth-authorization-server`
- Standard OAuth endpoints and metadata for MCP client discovery
- Support for PKCE (Proof Key for Code Exchange) with S256 method
- Dynamic client registration capabilities

### ✅ **Refresh Token Graceful Failure**
- Automatic token refresh using jsforce's built-in capabilities
- Graceful fallback when refresh fails with clear user guidance
- Session cleanup and re-authentication prompts

### ✅ **Personal OAuth Authentication**
- Complete authorization code flow implementation
- User-specific token management and storage
- Support for personal Salesforce accounts alongside service accounts

### ✅ **MCP Inspector Compatibility**
- Works with MCP Inspector's "Auth" button for automatic OAuth flow
- Standard OAuth discovery for seamless integration
- Real-time token management and refresh

### ✅ **Tool Compatibility**
- All 14 existing MCP tools updated with retry logic
- Zero breaking changes to tool interfaces
- Enhanced error handling for token expiration scenarios

## 🔧 Authentication Methods

### 1. **Username/Password** (Existing)
```bash
export SALESFORCE_CONNECTION_TYPE="User_Password"
export SALESFORCE_USERNAME="your_username"
export SALESFORCE_PASSWORD="your_password"
export SALESFORCE_TOKEN="your_security_token"
```

### 2. **OAuth Client Credentials** (Existing)
```bash
export SALESFORCE_CONNECTION_TYPE="OAuth_2.0_Client_Credentials"
export SALESFORCE_CLIENT_ID="your_client_id"
export SALESFORCE_CLIENT_SECRET="your_client_secret"
export SALESFORCE_INSTANCE_URL="https://your-domain.my.salesforce.com"
```

### 3. **Personal OAuth** (MCP Standard) ⭐
```bash
export SALESFORCE_CONNECTION_TYPE="OAuth_2.0_Personal"
export SALESFORCE_CLIENT_ID="your_client_id"
export SALESFORCE_CLIENT_SECRET="your_client_secret"
export SALESFORCE_INSTANCE_URL="https://test.salesforce.com"
export SALESFORCE_REDIRECT_URI="https://login.salesforce.com/services/oauth2/callback"
```

## 🔄 MCP OAuth Flow

### How MCP Inspector Uses OAuth
1. **Discovery**: MCP Inspector detects OAuth capabilities from server metadata
2. **Authorization**: Clicks "Auth" button → redirects to Salesforce login
3. **Consent**: User grants permissions to the MCP server
4. **Token Exchange**: Authorization code is exchanged for access/refresh tokens
5. **Resource Access**: All MCP tools now work with user's personal Salesforce data

### OAuth Discovery Document
The server exposes OAuth metadata that MCP clients can discover:
```json
{
  "authorization_endpoint": "https://login.salesforce.com/services/oauth2/authorize",
  "token_endpoint": "https://login.salesforce.com/services/oauth2/token",
  "scopes_supported": ["api", "id", "refresh_token", "web", "full"],
  "code_challenge_methods_supported": ["S256"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "client_credentials", "refresh_token"]
}
```

## 🔗 Personal OAuth Setup

### Step 1: Create Connected App
1. Go to Salesforce Setup → App Manager
2. Click "New Connected App"
3. Fill in basic information
4. Enable OAuth Settings:
   - ✅ Enable OAuth Settings
   - **Callback URL**: `https://test.salesforce.com/services/oauth2/success`
   - **Selected OAuth Scopes**: 
     - `api` - Access and manage your data
     - `id` - Access your basic information
     - `refresh_token` - Perform requests on your behalf at any time

### Step 2: Get Authorization URL
```javascript
import { personalOAuthHandler } from './dist/auth/oauthFlow.js';

const { authUrl, state } = await personalOAuthHandler.initiateAuthFlow({
  clientId: 'YOUR_CLIENT_ID',
  redirectUri: 'https://test.salesforce.com/services/oauth2/success',
  instanceUrl: 'https://test.salesforce.com'
  // scope defaults to 'id api refresh_token' - can be overridden if needed
}, 'temp_user_id'); // Temporary ID - will be replaced with real user info

console.log('Visit this URL:', authUrl);
```

### Step 3: Exchange Authorization Code
```javascript
const result = await personalOAuthHandler.handleCallback({
  code: 'AUTHORIZATION_CODE_FROM_REDIRECT',
  state: 'STATE_FROM_STEP_2'
}, clientId, clientSecret, redirectUri, instanceUrl);

console.log('Tokens stored for user:', result.userId); // Automatically retrieved from Salesforce
console.log('User info:', result.userInfo); // Real user data from Salesforce
```

## 🧪 Testing Your Setup

### Interactive Test Script
```bash
# Set up environment variables
cp .env.example .env
# Edit .env with your CLIENT_ID and optionally CLIENT_SECRET

# Run the interactive test script
npm run test:oauth
```

### What the Test Does
- ✅ **Default scope: 'id api refresh_token'** (essential scopes for full functionality)
- ✅ **Automatic user ID detection** (queries Salesforce for real user info)
- ✅ **Step-by-step guidance** (pauses for user input at each step)
- ✅ **Works with implicit or authorization code flow**
- ✅ **Real token testing** (verifies connection and functionality)

### OAuth Scopes Explained
The MCP server now uses a **default scope of 'id api refresh_token'** which provides:

**Default Scope Breakdown:**
- `id` - Access to user identity information (required for getUserInfo)
- `api` - Access to REST API endpoints (required for SOQL queries and DML operations)
- `refresh_token` - Ability to refresh access tokens (required for token refresh)

This default scope ensures:
1. ✅ User information can be retrieved automatically
2. ✅ All MCP tools have proper API access
3. ✅ Token refresh works seamlessly
4. ✅ Minimal but sufficient permissions for full functionality

You can still override the scope by setting `SALESFORCE_SCOPE` environment variable if needed.

### Manual Testing Flow
1. **Generate Auth URL**: Run test script to get authorization URL
2. **Browser Login**: Open URL, log into Salesforce
3. **Get Auth Code**: Copy code from redirect URL
4. **Token Exchange**: Use code with client secret to get tokens
5. **Test Tools**: Verify all MCP tools work with personal tokens

## 🔄 Token Refresh Logic

The implementation automatically handles token refresh:

```javascript
// Automatic retry on token expiration
return await executeWithRetry(
  async (conn) => await handleQueryRecords(conn, args),
  undefined,
  userId  // User-specific connection
);
```

### Token Expiration Handling
1. **Detection**: Multiple error patterns recognized
2. **Refresh**: Automatic refresh using stored refresh token
3. **Retry**: Original operation retried with new token
4. **Fallback**: Clear error message if refresh fails

## ⚠️ Error Scenarios & Solutions

### Session Expired
```
Error: Your Salesforce session has expired. Please re-authenticate to continue.

To re-authenticate:
1. Update your connection configuration
2. For personal OAuth, restart the authorization flow
3. For client credentials, verify your client ID and secret
```

### OAuth Authentication Failed
```
Error: OAuth authentication failed. Please check your client credentials and try again.
```

### Token Refresh Failed
```
Error: Session expired and token refresh failed. Please re-authenticate.
```

## 🛠️ Integration Examples

### MCP Inspector Testing
```json
{
  "mcpServers": {
    "salesforce": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "SALESFORCE_CONNECTION_TYPE": "OAuth_2.0_Personal",
        "SALESFORCE_CLIENT_ID": "your_client_id",
        "SALESFORCE_CLIENT_SECRET": "your_client_secret",
        "SALESFORCE_INSTANCE_URL": "https://test.salesforce.com"
      }
    }
  }
}
```

### Answer Agent AI Integration
The server now supports user-specific OAuth tokens, allowing each user to authenticate with their own Salesforce account while using the Answer Agent AI Chrome extension.

## 📊 Monitoring & Debugging

### Connection Statistics
```javascript
import { connectionManager } from './dist/utils/connectionManager.js';

const stats = connectionManager.getConnectionStats();
console.log('Active connections:', stats.activeConnections);
console.log('Stored tokens:', stats.storedTokens);
```

### OAuth Flow Statistics
```javascript
import { personalOAuthHandler } from './dist/auth/oauthFlow.js';

const oauthStats = personalOAuthHandler.getOAuthStats();
console.log('Pending auth flows:', oauthStats.pendingStates);
console.log('Stored user tokens:', oauthStats.storedTokens);
```

## 🔧 Advanced Configuration

### Custom Token Storage
```javascript
// Tokens are stored in-memory by default
// For production, consider implementing persistent storage
class PersistentTokenManager extends TokenManager {
  async storeToken(userId, tokenData) {
    // Store in database, Redis, etc.
  }
}
```

### Connection Pooling
```javascript
// Connections are automatically pooled per user
// Manual management available:
connectionManager.clearConnection(userId);
connectionManager.clearAllConnections();
```

### Token Refresh Scheduling
```javascript
// Automatic refresh is scheduled 5 minutes before expiry
// Customize via TokenManager configuration
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
```

## 🎯 Production Checklist

- [ ] Configure OAuth Connected App in Salesforce
- [ ] Set appropriate OAuth scopes (`id api refresh_token`)
- [ ] Secure client secret storage
- [ ] Test token refresh scenarios
- [ ] Verify all 14 MCP tools work with personal tokens
- [ ] Test with MCP Inspector
- [ ] Test with Answer Agent AI Chrome extension
- [ ] Monitor connection and token statistics
- [ ] Set up error logging and alerting

## 🆘 Troubleshooting

### Build Issues
```bash
npm install  # Ensure dependencies are installed
npm run build  # Should complete without errors
```

### Runtime Issues
```bash
node test-oauth.js    # Test OAuth functionality
node test-server.js   # Test server startup
```

### Common Problems
1. **Invalid Client ID**: Check Salesforce Connected App settings
2. **Redirect URI Mismatch**: Ensure exact match in Connected App
3. **Insufficient Scope**: Add required OAuth scopes in Connected App
4. **Token Expired**: Normal behavior, should auto-refresh

---

🎉 **Your OAuth implementation is now ready for production use!**

For additional support, check the test scripts and monitor the console output for detailed error messages.