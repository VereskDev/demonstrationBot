import { buildMediaTools } from "./media.ts";
import { buildMemoryTools } from "./memory.ts";
import { buildNoteTools } from "./notes.ts";
import { buildReminderTools } from "./reminders.ts";
import { buildTaskTools } from "./tasks.ts";
import { ToolRegistry } from "./types.ts";

export function buildToolset(): ToolRegistry {
  return new ToolRegistry([...buildNoteTools(), ...buildTaskTools(), ...buildReminderTools(), ...buildMemoryTools(), ...buildMediaTools()]);
}
