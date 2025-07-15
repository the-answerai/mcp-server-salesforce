import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { DMLResult } from "../types/salesforce";

export const INSERT_CASE: Tool = {
  name: "salesforce_insert_case",
  description: "Create new Salesforce Case records. Simplified interface specifically for Case creation - no need to specify operation or object type.",
  inputSchema: {
    type: "object",
    properties: {
      records: {
        type: "array",
        items: { type: "object" },
        description: "Array of Case records to create. Each record should contain Case fields like Subject, Status, Priority, etc."
      }
    },
    required: ["records"]
  }
};

export interface InsertCaseArgs {
  records: Record<string, any>[];
}

export async function handleInsertCase(conn: any, args: InsertCaseArgs) {
  const { records } = args;

  if (!records || records.length === 0) {
    throw new Error('At least one Case record is required');
  }

  // Always insert to Case object
  const result = await conn.sobject('Case').create(records);

  // Format DML results (similar to DML tool but Case-specific)
  const results = Array.isArray(result) ? result : [result];
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.length - successCount;

  let responseText = `Case INSERT operation completed.\n`;
  responseText += `Processed ${results.length} Case records:\n`;
  responseText += `- Successfully created: ${successCount}\n`;
  responseText += `- Failed to create: ${failureCount}\n\n`;

  // Show created Case IDs for successful records
  if (successCount > 0) {
    responseText += 'Successfully created Cases:\n';
    results.forEach((r: DMLResult, idx: number) => {
      if (r.success && r.id) {
        responseText += `  - Case ${idx + 1}: ${r.id}\n`;
      }
    });
    responseText += '\n';
  }

  // Show detailed error information for failed records
  if (failureCount > 0) {
    responseText += 'Failed Case creations:\n';
    results.forEach((r: DMLResult, idx: number) => {
      if (!r.success && r.errors) {
        responseText += `Case ${idx + 1}:\n`;
        if (Array.isArray(r.errors)) {
          r.errors.forEach((error) => {
            responseText += `  - ${error.message}`;
            if (error.statusCode) {
              responseText += ` [${error.statusCode}]`;
            }
            if (error.fields && error.fields.length > 0) {
              responseText += `\n    Fields: ${error.fields.join(', ')}`;
            }
            responseText += '\n';
          });
        } else {
          // Single error object
          const error = r.errors;
          responseText += `  - ${error.message}`;
          if (error.statusCode) {
            responseText += ` [${error.statusCode}]`;
          }
          if (error.fields) {
            const fields = Array.isArray(error.fields) ? error.fields.join(', ') : error.fields;
            responseText += `\n    Fields: ${fields}`;
          }
          responseText += '\n';
        }
      }
    });
  }

  return {
    content: [{
      type: "text",
      text: responseText
    }],
    isError: false,
  };
}