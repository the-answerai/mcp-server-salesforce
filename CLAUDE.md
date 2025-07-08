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
- **`src/tools/`**: Individual tool implementations (14 Salesforce operations)
- **`src/types/`**: TypeScript type definitions for connections, metadata, and Salesforce objects
- **`src/utils/`**: Utility functions for connection management and error handling

### MCP Server Implementation
The server is built on the `@modelcontextprotocol/sdk` and implements:
- **Tool Registration**: All 14 tools are registered in `index.ts:44-60`
- **Request Handling**: Centralized routing with type validation in `index.ts:63-336`
- **Error Handling**: Consistent error responses with Salesforce-specific details

### Authentication Architecture
Supports two authentication methods defined in `src/types/connection.ts`:
1. **Username/Password**: Traditional Salesforce login with security token
2. **OAuth 2.0 Client Credentials**: For server-to-server integrations

Connection logic is centralized in `src/utils/connection.ts:11-117`.

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

## Key Implementation Details

### Type Safety
All tool arguments go through strict TypeScript validation in the main request handler. Each tool has its own argument interface defined in its respective file.

### Connection Management  
The `createSalesforceConnection()` function handles both authentication methods and manages the jsforce connection instance that gets passed to all tools.

### Error Handling
Centralized error handling in `src/utils/errorHandler.ts` provides Salesforce-specific error formatting and user-friendly messages.

### Environment Configuration
Authentication is configured via environment variables:
- Username/Password: `SALESFORCE_USERNAME`, `SALESFORCE_PASSWORD`, `SALESFORCE_TOKEN`
- OAuth 2.0: `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`, `SALESFORCE_INSTANCE_URL`

## Development Notes

### Adding New Tools
1. Create tool implementation in `src/tools/`
2. Define argument types and validation
3. Register tool in `src/index.ts` (both ListTools and CallTool handlers)
4. Update README.md with tool documentation

### Testing Authentication
You can test both authentication methods by setting the appropriate environment variables and running the built server.

### TypeScript Configuration
- Target: ES2020
- Module: ES2022 with bundler resolution
- Strict mode enabled
- Generates declaration files for npm publishing

## OAuth Implementation & Token Management

### New Authentication Flows
The server now supports comprehensive OAuth token management:

- **Personal OAuth**: `OAuth_2_0_Personal` - User-specific authentication with personal Salesforce accounts
- **Authorization Code Flow**: `OAuth_2_0_Authorization_Code` - Standard OAuth flow with refresh tokens
- **Enhanced Client Credentials**: Improved error handling and retry logic

### Key Components

#### Token Management (`src/utils/tokenManager.ts`)
- Automatic token refresh scheduling
- Token expiration detection and handling
- Authorization code exchange for personal OAuth
- Secure token storage and cleanup

#### Connection Management (`src/utils/connectionManager.ts`)
- Connection pooling per user
- Automatic retry logic on token expiration
- Support for all authentication methods
- Connection validation and refresh capabilities

#### Personal OAuth Handler (`src/auth/oauthFlow.ts`)
- Authorization URL generation
- Secure state parameter management
- Token exchange and refresh workflows
- User token information management

#### Enhanced Error Handling (`src/utils/errorHandler.ts`)
- Token expiration detection across multiple error patterns
- OAuth-specific error identification
- User-friendly error messages with re-authentication guidance
- Retry logic for network and temporary errors

### Tool Integration
All 14 MCP tools have been updated to use the new connection manager with automatic retry logic. Each tool now gracefully handles token expiration by automatically refreshing tokens and retrying operations.

### Testing
- `test-oauth.js`: Comprehensive OAuth functionality tests
- `test-server.js`: Server startup verification
- `OAUTH_GUIDE.md`: Complete setup and usage documentation

### Environment Variables
- `SALESFORCE_CONNECTION_TYPE`: Set to `OAuth_2_0_Personal` for personal OAuth
- `SALESFORCE_CLIENT_ID`: OAuth client ID from Connected App
- `SALESFORCE_CLIENT_SECRET`: OAuth client secret (required for personal OAuth)
- `SALESFORCE_INSTANCE_URL`: Salesforce instance URL (e.g., https://test.salesforce.com)