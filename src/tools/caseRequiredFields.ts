import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SalesforceField, SalesforceDescribeResponse } from "../types/salesforce";

// Extended interface for this tool only - does not affect other tools
interface ExtendedSalesforceField extends SalesforceField {
  createable: boolean;
  updateable: boolean;
  calculated: boolean;
  autoNumber: boolean;
  defaultedOnCreate: boolean;
}

export const CASE_REQUIRED_FIELDS: Tool = {
  name: "salesforce_case_required_fields",
  description: "Get only the required fields that users must actually input when creating a Salesforce Case. Excludes auto-populated fields, formula fields, and system fields. Shows which required fields have default values.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

export async function handleCaseRequiredFields(conn: any) {
  const describe = await conn.describe('Case') as SalesforceDescribeResponse;
  
  // Type assertion to access extended properties from Salesforce API
  const extendedFields = describe.fields as ExtendedSalesforceField[];
  
  // Filter to only required fields that users must actually input
  const userEditableRequiredFields = extendedFields.filter((field) => {
    // Must be required (non-nillable)
    if (field.nillable) return false;
    
    // Must be createable (user can set during creation)
    if (!field.createable) return false;
    
    // Filter out formula/calculated fields
    if (field.calculated) return false;
    
    // Filter out auto-number fields
    if (field.autoNumber) return false;
    
    // Filter out system fields by name pattern
    const systemFields = ['id', 'createddate', 'lastmodifieddate', 'createdbyid', 'lastmodifiedbyid', 'systemmodstamp'];
    if (systemFields.includes(field.name.toLowerCase())) return false;
    
    return true;
  });
  
  // Separate fields with and without defaults
  const fieldsWithDefaults = userEditableRequiredFields.filter(field => 
    field.defaultValue !== null || field.defaultedOnCreate
  );
  const fieldsWithoutDefaults = userEditableRequiredFields.filter(field => 
    field.defaultValue === null && !field.defaultedOnCreate
  );
  
  // Format the output
  const formattedDescription = `
Object: ${describe.name} (${describe.label}) - User Input Required Fields

${fieldsWithoutDefaults.length > 0 ? `FIELDS REQUIRING USER INPUT (${fieldsWithoutDefaults.length}):
${fieldsWithoutDefaults.map((field: ExtendedSalesforceField) => `  - ${field.name} (${field.label})
    Type: ${field.type}${field.length ? `, Length: ${field.length}` : ''}
    Required: Yes, no default value
    ${field.referenceTo && field.referenceTo.length > 0 ? `References: ${field.referenceTo.join(', ')}` : ''}
    ${field.picklistValues && field.picklistValues.length > 0 ? `Picklist Values: ${field.picklistValues.map((v: { value: string }) => v.value).join(', ')}` : ''}`
  ).join('\n')}` : ''}

${fieldsWithDefaults.length > 0 ? `REQUIRED FIELDS WITH DEFAULTS (${fieldsWithDefaults.length}):
${fieldsWithDefaults.map((field: ExtendedSalesforceField) => `  - ${field.name} (${field.label})
    Type: ${field.type}${field.length ? `, Length: ${field.length}` : ''}
    Required: Yes, but has default${field.defaultValue !== null ? ` (${field.defaultValue})` : ''}
    ${field.referenceTo && field.referenceTo.length > 0 ? `References: ${field.referenceTo.join(', ')}` : ''}
    ${field.picklistValues && field.picklistValues.length > 0 ? `Picklist Values: ${field.picklistValues.map((v: { value: string }) => v.value).join(', ')}` : ''}`
  ).join('\n')}` : ''}

Total fields requiring user input: ${fieldsWithoutDefaults.length}
Total required fields with defaults: ${fieldsWithDefaults.length}`;

  return {
    content: [{
      type: "text",
      text: formattedDescription
    }],
    isError: false,
  };
}