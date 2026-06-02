import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { JoplinClient } from "./joplin";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const client = new JoplinClient();

  pi.registerTool({
    name: "joplin_list_notebooks",
    label: "List Notebooks",
    description: "List all notebooks in Joplin",
    parameters: Type.Object({}),
    async execute() {
      const notebooks = await client.listNotebooks();
      return {
        content: [{ type: "text", text: JSON.stringify(notebooks, null, 2) }],
        details: { count: notebooks.length },
      };
    },
  });

  pi.registerTool({
    name: "joplin_list_notes",
    label: "List Notes",
    description: "List notes. If notebook is provided, lists notes in that notebook. Otherwise lists all notes.",
    parameters: Type.Object({
      notebook: Type.Optional(Type.String({ description: "Notebook ID or name. Leave empty for all notes." })),
    }),
    async execute(_id, params) {
      const notes = await client.listNotes(params.notebook);
      
      const output = JSON.stringify(notes, null, 2);
      const truncation = truncateHead(output, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let text = truncation.content;
      if (truncation.truncated) {
        text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines. Query specific notebooks if needed.]`;
      }

      return {
        content: [{ type: "text", text }],
        details: { count: notes.length },
      };
    },
  });

  pi.registerTool({
    name: "joplin_read_note",
    label: "Read Note",
    description: "Read the content of a specific note",
    parameters: Type.Object({
      note: Type.String({ description: "Note ID or title" }),
    }),
    async execute(_id, params) {
      const content = await client.readNote(params.note);
      
      const truncation = truncateHead(content, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let text = truncation.content;
      if (truncation.truncated) {
        text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines.]`;
      }

      return {
        content: [{ type: "text", text }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "joplin_list_notes_by_tag",
    label: "List Notes by Tag",
    description: "List all notes that have a specific tag",
    parameters: Type.Object({
      tag: Type.String({ description: "Tag name" }),
    }),
    async execute(_id, params) {
      const notes = await client.listNotesByTag(params.tag);
      const output = JSON.stringify(notes, null, 2);
      
      const truncation = truncateHead(output, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let text = truncation.content;
      if (truncation.truncated) {
        text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines.]`;
      }

      return {
        content: [{ type: "text", text }],
        details: { count: notes.length },
      };
    },
  });
}
