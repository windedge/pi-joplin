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
    description: "List notes. Can filter by notebook, tag, or both simultaneously. Leave empty for all notes.",
    parameters: Type.Object({
      notebook: Type.Optional(Type.String({ description: "Notebook ID or name to filter by." })),
      tag: Type.Optional(Type.String({ description: "Tag name to filter by." })),
    }),
    async execute(_id, params) {
      let notes;
      
      if (params.notebook && params.tag) {
        // Since Joplin CLI doesn't support intersecting both natively in a single command,
        // we fetch both and intersect them in memory by ID.
        const [byNotebook, byTag] = await Promise.all([
          client.listNotes(params.notebook),
          client.listNotesByTag(params.tag)
        ]);
        const tagNoteIds = new Set(byTag.map(n => n.id));
        notes = byNotebook.filter(n => tagNoteIds.has(n.id));
      } else if (params.tag) {
        notes = await client.listNotesByTag(params.tag);
      } else {
        notes = await client.listNotes(params.notebook);
      }
      
      const output = JSON.stringify(notes, null, 2);
      const truncation = truncateHead(output, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let text = truncation.content;
      if (truncation.truncated) {
        text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines. Query specific notebooks or tags if needed.]`;
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
    name: "joplin_get_note_metadata",
    label: "Get Note Metadata",
    description: "Get metadata for a specific note (e.g. parent_id, created_time, is_todo, etc.)",
    parameters: Type.Object({
      note: Type.String({ description: "Note ID or title" }),
    }),
    async execute(_id, params) {
      const metadata = await client.getNoteMetadata(params.note);
      return {
        content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }],
        details: { metadata },
      };
    },
  });
}
