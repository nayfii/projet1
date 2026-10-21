import { DEPARTMENTS, TOOL_FIELD_TYPES, MEMORY_SCOPES, OUTPUT_FORMATS } from "./definitions";

/** "Turn into a tool": what the AI is asked to extract from a successful conversation. */
export const TOOL_DRAFT_SYSTEM = [
  "Task: turn a conversation into a reusable tool.",
  "A person had a useful conversation with an AI assistant and wants a tool their colleagues can run again with a simple form. From the conversation, write a JSON object in the conversation's language:",
  '{"name": "...", "description": "...", "department": "...", "input_fields": [{"label": "...", "type": "...", "required": true, "options": []}], "instructions": "...", "output_format": "...", "memory_scope": "..."}',
  `- department: one of ${DEPARTMENTS.join(", ")};`,
  `- input_fields: 1 to 6 fields for what changes from one run to the next (the client, notes, a date, a tone…); type is one of ${TOOL_FIELD_TYPES.join(", ")} ("client" picks one of the company's clients, "select" needs options);`,
  "- instructions: what the assistant must do each time, written to the assistant, general and complete (steps, structure, tone, constraints learned in the conversation). Refer to the form's fields by their labels;",
  `- output_format: one of ${OUTPUT_FORMATS.join(", ")}; memory_scope: one of ${MEMORY_SCOPES.join(", ")} (company_and_client when the tool needs what the company knows about the client);`,
  "- never copy details specific to this conversation (names, amounts, dates, placeholders such as [CLIENT_1]) into the name, description or instructions: they become form fields.",
  "Answer with the JSON object only.",
].join("\n");
