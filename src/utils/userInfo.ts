/**
 * Utility functions for querying Salesforce user information
 */

/**
 * Get user information from Salesforce using a connection
 */
export async function getUserInfo(connection: any): Promise<{
  userId: string;
  username: string;
  email: string;
  organizationId: string;
  displayName: string;
} | null> {
  try {
    // Use jsforce's identity() method to get user info - this is the correct way
    const identity = await connection.identity();
    
    if (identity) {
      return {
        userId: identity.user_id,
        username: identity.username,
        email: identity.email || 'unknown',
        organizationId: identity.organization_id,
        displayName: identity.display_name || identity.username || 'Unknown User'
      };
    }
    
    return null;
  } catch (error) {
    console.error('Failed to get user info via identity():', error);
    
    // Fallback to connection userInfo if identity() fails
    if (connection.userInfo) {
      return {
        userId: connection.userInfo.id,
        username: connection.userInfo.username || 'unknown',
        email: connection.userInfo.email || 'unknown', 
        organizationId: connection.userInfo.organizationId || '',
        displayName: connection.userInfo.display_name || connection.userInfo.username || 'Unknown User'
      };
    }
    
    return null;
  }
}

/**
 * Generate a friendly user identifier from user info
 */
export function generateUserId(userInfo: { userId: string; username: string; email: string }): string {
  // Use email as primary identifier (most user-friendly)
  if (userInfo.email && userInfo.email !== 'unknown') {
    return userInfo.email;
  }
  
  // Fallback to username
  if (userInfo.username && userInfo.username !== 'unknown') {
    return userInfo.username;
  }
  
  // Last resort: Salesforce user ID
  return userInfo.userId;
}

/**
 * Get organization information from Salesforce
 */
export async function getOrganizationInfo(connection: any): Promise<{
  organizationId: string;
  organizationName: string;
  instanceUrl: string;
} | null> {
  try {
    const orgQuery = `
      SELECT 
        Id, 
        Name, 
        InstanceName,
        IsSandbox,
        OrganizationType
      FROM Organization 
      LIMIT 1
    `;
    
    const result = await connection.query(orgQuery);
    
    if (result.records && result.records.length > 0) {
      const org = result.records[0];
      return {
        organizationId: org.Id,
        organizationName: org.Name,
        instanceUrl: connection.instanceUrl || ''
      };
    }
    
    return null;
  } catch (error) {
    console.error('Failed to get organization info:', error);
    return null;
  }
}