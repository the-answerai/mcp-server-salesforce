#!/usr/bin/env node

/**
 * Interactive OAuth Testing Script for Salesforce MCP Server
 * Walks through OAuth flow step-by-step with user interaction
 */

import { config } from "dotenv";
config();
import readline from "readline";
import { personalOAuthHandler } from "./dist/auth/oauthFlow.js";
import { connectionManager } from "./dist/utils/connectionManager.js";
import { tokenManager } from "./dist/utils/tokenManager.js";

// Setup readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to get user input
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Helper function to pause and wait for user
function waitForUser(message) {
  return new Promise((resolve) => {
    rl.question(`${message}\nPress Enter when ready to continue...`, () => {
      resolve();
    });
  });
}

// Parse URL parameters from redirect URL
function parseUrlParams(url) {
  const params = {};

  // Handle both hash (#) and query (?) parameters
  let paramString = "";
  if (url.includes("#")) {
    paramString = url.split("#")[1];
  } else if (url.includes("?")) {
    paramString = url.split("?")[1];
  }

  if (paramString) {
    paramString.split("&").forEach((param) => {
      const [key, value] = param.split("=");
      if (key && value) {
        params[key] = decodeURIComponent(value);
      }
    });
  }

  return params;
}

// Configuration
const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID;
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET;
const REDIRECT_URI = process.env.SALESFORCE_REDIRECT_URI;
const INSTANCE_URL = process.env.SALESFORCE_INSTANCE_URL;
const SCOPE = process.env.SALESFORCE_SCOPE;
// User ID will be determined from Salesforce after OAuth
let CURRENT_USER_ID = null;

console.log("🧪 Interactive Salesforce OAuth Testing\n");
console.log("This script will walk you through the OAuth flow step by step.\n");

async function runInteractiveOAuthTest() {
  console.log(
    "═══════════════════════════════════════════════════════════════════════════════"
  );
  console.log("📋 PREREQUISITES CHECK");
  console.log(
    "═══════════════════════════════════════════════════════════════════════════════"
  );

  // Check required environment variables
  console.log("Checking configuration...");
  console.log(`✅ Client ID: ${CLIENT_ID ? "✓ Set" : "❌ Missing"}`);
  console.log(`✅ Client Secret: ${CLIENT_SECRET ? "✓ Set" : "❌ Missing"}`);
  console.log(`✅ Redirect URI: ${REDIRECT_URI}`);
  console.log(`✅ Instance URL: ${INSTANCE_URL}`);

  if (!CLIENT_ID) {
    console.log("\n❌ Missing SALESFORCE_CLIENT_ID environment variable");
    console.log("Please set it in your .env file or environment");
    rl.close();
    return;
  }

  if (!CLIENT_SECRET) {
    console.log(
      "\n⚠️  Missing SALESFORCE_CLIENT_SECRET - token exchange will be skipped"
    );
  }

  console.log(
    "\n═══════════════════════════════════════════════════════════════════════════════"
  );
  console.log("🚀 STEP 1: Generate Authorization URL");
  console.log(
    "═══════════════════════════════════════════════════════════════════════════════"
  );

  try {
    // Generate authorization URL with specific scopes for testing
    const { authUrl, state } = await personalOAuthHandler.initiateAuthFlow(
      {
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        instanceUrl: INSTANCE_URL,
        scope: SCOPE,
      },
      "temp_user_id"
    ); // Temporary user ID, will be replaced with real one

    console.log("✅ Authorization URL generated successfully!\n");
    console.log("🔗 AUTHORIZATION URL:");
    console.log(authUrl);
    console.log(`\n🔐 State Parameter: ${state}`);

    console.log("\n📋 INSTRUCTIONS:");
    console.log("1. Copy the authorization URL above");
    console.log("2. Open it in your web browser");
    console.log("3. Log in to your Salesforce account");
    console.log("4. Grant the requested permissions");
    console.log(
      "5. After granting permission, you will be redirected to a success page"
    );
    console.log(
      "6. Copy the ENTIRE redirect URL from your browser address bar"
    );
    console.log("7. Come back here and paste it when prompted");
    console.log("");
    console.log("🧪 TEST GOAL:");
    console.log(`   We're requesting: ${SCOPE || 'id api refresh_token (default)'}`);
    console.log(`   Default scope includes 'id' for user info and 'api' for REST API access`);

    await waitForUser("\n⏸️  Complete steps 1-7 above, then come back here");

    console.log(
      "\n═══════════════════════════════════════════════════════════════════════════════"
    );
    console.log("📥 STEP 2: Get Redirect URL");
    console.log(
      "═══════════════════════════════════════════════════════════════════════════════"
    );

    const redirectUrl = await askQuestion(
      "\n📋 Paste the complete redirect URL from your browser:\n> "
    );

    if (!redirectUrl || redirectUrl.length < 10) {
      console.log("❌ Invalid or empty URL provided");
      rl.close();
      return;
    }

    console.log("\n✅ Redirect URL received, parsing parameters...");

    // Parse the redirect URL
    const params = parseUrlParams(redirectUrl);
    console.log("\n📊 Parsed Parameters:");
    Object.keys(params).forEach((key) => {
      const value = key.includes("token") ? "***HIDDEN***" : params[key];
      console.log(`   ${key}: ${value}`);
    });

    // Check for errors
    if (params.error) {
      console.log(`\n❌ OAuth Error: ${params.error}`);
      if (params.error_description) {
        console.log(`📝 Description: ${params.error_description}`);
      }
      rl.close();
      return;
    }

    // Check what type of response we got
    const hasCode = params.code;
    const hasAccessToken = params.access_token;

    if (!hasCode && !hasAccessToken) {
      console.log(
        "\n❌ No authorization code or access token found in redirect URL"
      );
      console.log(
        "Make sure you copied the complete URL after granting permission"
      );
      rl.close();
      return;
    }

    console.log(
      "\n═══════════════════════════════════════════════════════════════════════════════"
    );
    console.log("🔄 STEP 3: Process OAuth Response");
    console.log(
      "═══════════════════════════════════════════════════════════════════════════════"
    );

    if (hasAccessToken) {
      console.log("✅ Access token received (implicit flow)");

      // For implicit flow, we get the token directly
      const tokenData = {
        accessToken: params.access_token,
        refreshToken: params.refresh_token,
        instanceUrl: params.instance_url
          ? decodeURIComponent(params.instance_url)
          : INSTANCE_URL,
        scope: params.scope,
        tokenType: params.token_type || "Bearer",
      };

      console.log("📊 Token Information:");
      console.log(`   Token Type: ${tokenData.tokenType}`);
      console.log(`   Instance URL: ${tokenData.instanceUrl}`);
      console.log(`   Requested Scope: ${SCOPE}`);
      console.log(`   Granted Scope: ${tokenData.scope}`);
      console.log(
        `   Has Refresh Token: ${tokenData.refreshToken ? "Yes" : "No"}`
      );

      // For implicit flow, we need to get user info manually
      console.log("\n🔍 Getting user information from Salesforce...");

      try {
        // Import jsforce and user info utilities
        const jsforce = (await import("jsforce")).default;
        const { getUserInfo, generateUserId } = await import(
          "./dist/utils/userInfo.js"
        );

        // Create temporary connection to get user info
        const tempConnection = new jsforce.Connection({
          instanceUrl: tokenData.instanceUrl,
          accessToken: tokenData.accessToken,
        });

        const userInfo = await getUserInfo(tempConnection);
        if (userInfo) {
          CURRENT_USER_ID = generateUserId(userInfo);
          tokenData.userId = CURRENT_USER_ID;

          console.log("✅ User information retrieved:");
          console.log(`   User ID: ${CURRENT_USER_ID}`);
          console.log(`   Display Name: ${userInfo.displayName}`);
          console.log(`   Organization: ${userInfo.organizationId}`);

          // Store the token with real user ID
          await tokenManager.storeToken(CURRENT_USER_ID, tokenData);
          console.log("\n✅ Token stored successfully");

          await testStoredToken(tokenData, CURRENT_USER_ID);
        } else {
          console.log(
            "⚠️  Could not retrieve user info, using temporary storage"
          );
          CURRENT_USER_ID = "temp_user_" + Date.now();
          tokenData.userId = CURRENT_USER_ID;
          await tokenManager.storeToken(CURRENT_USER_ID, tokenData);
          await testStoredToken(tokenData, CURRENT_USER_ID);
        }
      } catch (error) {
        console.log("⚠️  Error getting user info:", error.message);
        CURRENT_USER_ID = "temp_user_" + Date.now();
        tokenData.userId = CURRENT_USER_ID;
        await tokenManager.storeToken(CURRENT_USER_ID, tokenData);
        await testStoredToken(tokenData, CURRENT_USER_ID);
      }
    } else if (hasCode) {
      console.log("✅ Authorization code received (authorization code flow)");

      if (!CLIENT_SECRET) {
        console.log("⚠️  Cannot exchange code for token without CLIENT_SECRET");
        console.log("📝 Authorization code (for reference):");
        console.log(`   Code: ${params.code.substring(0, 20)}...`);
        console.log(`   State: ${params.state}`);
        console.log(
          "\nTo complete the flow, set SALESFORCE_CLIENT_SECRET in your environment"
        );
      } else {
        console.log("🔄 Exchanging authorization code for tokens...");

        try {
          const result = await personalOAuthHandler.handleCallback(
            {
              code: params.code,
              state: params.state,
            },
            CLIENT_ID,
            CLIENT_SECRET,
            REDIRECT_URI,
            INSTANCE_URL
          );

          console.log("✅ Token exchange successful!");
          console.log("📊 Token Information:");
          console.log(`   User ID: ${result.userId}`);
          console.log(`   Display Name: ${result.userInfo.displayName}`);
          console.log(`   Instance URL: ${result.tokenData.instanceUrl}`);
          console.log(`   Requested Scope: ${SCOPE}`);
          console.log(`   Granted Scope: ${result.tokenData.scope}`);
          console.log(
            `   Has Refresh Token: ${
              result.tokenData.refreshToken ? "Yes" : "No"
            }`
          );

          CURRENT_USER_ID = result.userId;
          await testStoredToken(result.tokenData, result.userId);
        } catch (error) {
          console.log("❌ Token exchange failed:", error.message);
        }
      }
    }
  } catch (error) {
    console.log("❌ OAuth flow failed:", error.message);
  }

  console.log(
    "\n═══════════════════════════════════════════════════════════════════════════════"
  );
  console.log("🧪 STEP 4: Test Connection Manager");
  console.log(
    "═══════════════════════════════════════════════════════════════════════════════"
  );

  await testConnectionManager();

  console.log(
    "\n═══════════════════════════════════════════════════════════════════════════════"
  );
  console.log("✅ INTERACTIVE OAUTH TEST COMPLETE");
  console.log(
    "═══════════════════════════════════════════════════════════════════════════════"
  );

  console.log("\n🎉 OAuth flow testing completed!");
  console.log("\n📋 Next Steps:");
  console.log("   1. Test MCP tools with the stored tokens");
  console.log("   2. Test token refresh scenarios");
  console.log("   3. Test with MCP Inspector");
  console.log("   4. Test with Answer Agent AI Chrome extension");

  rl.close();
}

async function testStoredToken(tokenData, userId) {
  console.log("\n🧪 Testing stored token...");

  try {
    // Test token retrieval
    const retrievedToken = await tokenManager.getToken(userId);
    if (retrievedToken) {
      console.log("✅ Token retrieval: SUCCESS");
      console.log(
        "✅ Token expiration check: " +
          (tokenManager.isTokenExpired(retrievedToken) ? "EXPIRED" : "VALID")
      );
    } else {
      console.log("❌ Token retrieval: FAILED");
    }

    // Test connection creation
    console.log("\n🔗 Testing connection creation...");
    const connection = await connectionManager.getConnection(userId, {
      type: "OAuth_2.0_Authorization_Code",
      tokenData: tokenData,
    });

    if (connection) {
      console.log("✅ Connection creation: SUCCESS");
      console.log("✅ Connection instance URL:", connection.instanceUrl);
    } else {
      console.log("❌ Connection creation: FAILED");
    }
  } catch (error) {
    console.log("❌ Token test failed:", error.message);
  }
}

async function testConnectionManager() {
  try {
    const stats = connectionManager.getConnectionStats();
    console.log("✅ Connection stats:", stats);

    const oauthStats = personalOAuthHandler.getOAuthStats();
    console.log("✅ OAuth stats:", oauthStats);

    console.log("✅ Connection manager is functional");
  } catch (error) {
    console.log("❌ Connection manager test failed:", error.message);
  }
}

// Handle cleanup
process.on("SIGINT", () => {
  console.log("\n\n👋 Exiting...");
  rl.close();
  process.exit(0);
});

// Run the interactive test
runInteractiveOAuthTest().catch((error) => {
  console.error("❌ Test failed:", error);
  rl.close();
  process.exit(1);
});
