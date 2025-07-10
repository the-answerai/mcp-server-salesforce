# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Salesforce MCP (Model Context Protocol) Server implementation that enables Claude to interact with Salesforce APIs. It provides comprehensive tools for querying, modifying, and managing Salesforce data and metadata through natural language interactions.

## Development Commands

### Building and Testing
```bash
# Build the project (compiles TypeScript and sets executable permissions)
npm run build

# Watch mode for development (auto-recompile on changes)
npm run watch

# Install dependencies
npm install

# Run the server locally (after building)
node dist/index.js
```

### Package Management
This project uses npm for package management and requires Node.js with ES2022 module support.

## Architecture Overview

### Core Structure
The project follows a modular architecture with clear separation of concerns:

- **`src/index.ts`**: Main MCP server entry point that registers all tools and handles routing
- **`src/tools/`**: Individual tool implementations (17 Salesforce operations)
- **`src/types/`**: TypeScript type definitions for connections, metadata, and Salesforce objects
- **`src/utils/`**: Utility functions for connection management and error handling

### MCP Server Implementation
The server is built on the `@modelcontextprotocol/sdk` and implements:
- **Tool Registration**: All 17 tools are registered in `index.ts`
- **Request Handling**: Centralized routing with type validation and object parameter support
- **Error Handling**: Consistent error responses with Salesforce-specific details

### Authentication Architecture
Supports multiple authentication methods defined in `src/types/connection.ts`:
1. **Username/Password**: Traditional Salesforce login with security token
2. **OAuth 2.0 Client Credentials**: For server-to-server integrations
3. **Personal OAuth**: User-specific authentication with access tokens
4. **Direct Access Token**: Stateless authentication via access token parameter

Connection logic is centralized in `src/utils/connectionManager.ts` with automatic retry and token refresh capabilities.

### Tool Categories

#### Data Operations (4 tools)
- **Query**: `salesforce_query_records` - SOQL queries with relationship support
- **Aggregate**: `salesforce_aggregate_query` - GROUP BY and aggregate functions  
- **DML**: `salesforce_dml_records` - Insert, update, delete, upsert operations
- **Search**: `salesforce_search_all` - Cross-object SOSL search

#### Metadata Management (4 tools)
- **Object Search**: `salesforce_search_objects` - Find objects by pattern matching
- **Object Description**: `salesforce_describe_object` - Schema information
- **Object Management**: `salesforce_manage_object` - Create/modify custom objects
- **Field Management**: `salesforce_manage_field` - Create/modify fields with automatic FLS

#### Field Level Security (1 tool)
- **Field Permissions**: `salesforce_manage_field_permissions` - Grant/revoke field access

#### Apex Development (4 tools)
- **Read Classes**: `salesforce_read_apex` - View Apex class source code
- **Write Classes**: `salesforce_write_apex` - Create/update Apex classes
- **Read Triggers**: `salesforce_read_apex_trigger` - View trigger source code  
- **Write Triggers**: `salesforce_write_apex_trigger` - Create/update triggers

#### Development Support (2 tools)
- **Execute Apex**: `salesforce_execute_anonymous` - Run anonymous Apex code
- **Debug Logs**: `salesforce_manage_debug_logs` - Enable/disable/retrieve debug logs

#### OAuth Support (2 tools)
- **OAuth Metadata**: `salesforce_oauth_metadata` - Provides OAuth discovery metadata for MCP clients
- **Refresh Token**: `salesforce_refresh_token` - Refresh expired access tokens using refresh tokens

## Key Implementation Details

### Type Safety
All tool arguments go through strict TypeScript validation in the main request handler. Each tool has its own argument interface defined in its respective file.

### Connection Management  
The `ConnectionManager` class handles all authentication methods with connection pooling, automatic retry logic, and token refresh capabilities. The `executeWithRetry()` method provides robust error handling with object-based parameters for better type safety.

### Error Handling
Centralized error handling in `src/utils/errorHandler.ts` provides Salesforce-specific error formatting and user-friendly messages.

### Environment Configuration
Authentication is configured via environment variables:
- Username/Password: `SALESFORCE_USERNAME`, `SALESFORCE_PASSWORD`, `SALESFORCE_TOKEN`
- OAuth 2.0: `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`, `SALESFORCE_INSTANCE_URL`
- Access Token: All tools accept optional `accessToken` parameter for stateless authentication

## Development Notes

### Adding New Tools
1. Create tool implementation in `src/tools/`
2. Define argument types with optional `accessToken` parameter
3. Register tool in `src/index.ts` (both ListTools and CallTool handlers)
4. Use `executeWithRetry` with object parameters for connection management
5. Update README.md with tool documentation

### Testing Authentication
You can test authentication methods by:
1. Setting environment variables for username/password or client credentials
2. Using the `salesforce_oauth_metadata` tool to get OAuth URLs
3. Passing access tokens directly to any tool via the `accessToken` parameter

### TypeScript Configuration
- Target: ES2020
- Module: ES2022 with bundler resolution
- Strict mode enabled
- Generates declaration files for npm publishing

## OAuth Implementation & Token Management

### Stateless Authentication Architecture
The server operates in a fully stateless mode with no persistent token storage:

- **Direct Access Tokens**: All tools accept optional `accessToken` parameter
- **URL Decoding**: Automatic handling of URL-encoded tokens from OAuth redirects
- **Token Refresh**: Client-managed token refresh using dedicated tool
- **OAuth Discovery**: Metadata endpoint for MCP client auto-discovery

### Key Components

#### Token Management (`src/utils/tokenManager.ts`)
- Utility functions for token operations (no persistence)
- Token expiration detection and validation
- Authorization code exchange for OAuth flows
- HTTP-based token refresh operations

#### Connection Management (`src/utils/connectionManager.ts`)
- Stateless connection creation with connection pooling
- Automatic retry logic on token expiration
- Support for all authentication methods including direct access tokens
- Object-based parameters for improved type safety (`ExecuteWithRetryOptions`)

#### Enhanced Error Handling (`src/utils/errorHandler.ts`)
- Token expiration detection across multiple error patterns
- OAuth-specific error identification and user guidance
- Retry logic for network and temporary errors
- Clean error messages without stack traces

### Tool Integration
All 17 MCP tools support the new stateless architecture:
- Optional `accessToken` parameter in all tool schemas
- Automatic retry logic with token refresh
- Object-based parameter passing for better maintainability
- Graceful handling of token expiration and URL encoding

### Environment Variables
- `SALESFORCE_CLIENT_ID`: OAuth client ID from Connected App
- `SALESFORCE_CLIENT_SECRET`: OAuth client secret (for token refresh)
- `SALESFORCE_INSTANCE_URL`: Salesforce instance URL
- `SALESFORCE_REDIRECT_URI`: OAuth callback URL for Connected App