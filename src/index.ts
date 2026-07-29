import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { JoplinClient } from "./joplin";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import {
  type NotebookRef,
  type SessionJoplinConfig,
  loadGlobalConfig,
  saveGlobalConfig,
  getGlobalAllowedTools,
  addGlobalAllowedTool,
  selectConfiguredRoots,
  materializeScope,
  resolveNotebookInputs,
  parseNotebookInputList,
  formatScopeSummary,
  isSubsetById,
} from "./scope";

/** Tag applied to every note/todo created via joplin_create_note. */
export const AI_CREATED_NOTE_TAG = "AI-Generated";

export default function (pi: ExtensionAPI) {
  let client = new JoplinClient(process.env.JOPLIN_PROFILE_PATH);

  let myConfig: SessionJoplinConfig = {};
  let effectiveRoots: NotebookRef[] | null = null;
  let scopeFailClosed = false;

  function scopeDescriptionSuffix(): string {
    if (scopeFailClosed) {
      return " NOTE: Notebook scope is fail-closed (no valid allowed notebooks). All Joplin access is denied until scope is reconfigured via /joplin-scope.";
    }
    if (effectiveRoots && effectiveRoots.length > 0) {
      const names = effectiveRoots.map((r) => r.title).join(", ");
      return ` NOTE: Access is restricted to these notebooks and their sub-notebooks: ${names}. Requests outside this scope will fail. Effective scope: ${formatScopeSummary(effectiveRoots)}.`;
    }
    return "";
  }

  async function applyScopeFromConfig() {
    const global = await loadGlobalConfig();
    const configured = selectConfiguredRoots(global.allowedNotebooks, myConfig.allowedNotebooks);

    let notebooks: any[];
    try {
      notebooks = await client.listAllNotebooks();
    } catch {
      // Client may not be initialized yet; apply a conservative scope from config ids only.
      if (configured.kind === "unrestricted") {
        client.setScope(null, "unrestricted");
        effectiveRoots = null;
        scopeFailClosed = false;
        return;
      }
      if (configured.kind === "fail-closed") {
        client.setScope(new Set(), formatScopeSummary(null, configured.reason));
        effectiveRoots = [];
        scopeFailClosed = true;
        return;
      }
      // Restricted but cannot validate tree yet: allow configured root ids only (no descendants yet)
      const ids = new Set(configured.roots.map((r) => r.id));
      client.setScope(ids, formatScopeSummary(configured.roots));
      effectiveRoots = configured.roots;
      scopeFailClosed = false;
      return;
    }

    const materialized = materializeScope(configured, notebooks);
    client.setScope(materialized.allowedIds, materialized.summary);
    effectiveRoots = materialized.roots;
    scopeFailClosed = materialized.failClosed;
  }

  async function reloadClient() {
    const global = await loadGlobalConfig();
    const profilePath =
      myConfig.profilePath || global.profilePath || process.env.JOPLIN_PROFILE_PATH;

    client = new JoplinClient(profilePath);
    if (myConfig.apiToken) {
      await client.setApiToken(myConfig.apiToken);
    }

    try {
      await client.init();
    } catch {
      // Ignore init errors during background load; tools will throw if not initialized.
    }

    await applyScopeFromConfig();
    registerAllTools();
  }

  function persistSessionConfig() {
    pi.appendEntry("joplin-config", myConfig);
  }

  async function promptAndSetScope(
    ctx: { ui: { input: (prompt: string, initial?: string) => Promise<string | undefined>; select: (prompt: string, options: string[]) => Promise<string | undefined>; notify: (msg: string, level?: string) => void } },
    target: "global" | "session"
  ): Promise<boolean> {
    const global = await loadGlobalConfig();

    let notebooks: any[];
    try {
      notebooks = await client.listAllNotebooks();
    } catch (err: any) {
      ctx.ui.notify(`Cannot list notebooks: ${err?.message || err}. Configure connection first.`, "error");
      return false;
    }

    const hint =
      target === "session" && global.allowedNotebooks && global.allowedNotebooks.length > 0
        ? `Enter notebook names or IDs (comma-separated). Must be a subset of global scope: ${global.allowedNotebooks.map((n) => n.title).join(", ")}`
        : "Enter notebook names or IDs (comma-separated). Each entry includes that notebook and all sub-notebooks.";

    const raw = await ctx.ui.input(hint, "");
    if (raw === undefined) return false;

    const inputs = parseNotebookInputList(raw);
    if (inputs.length === 0) {
      ctx.ui.notify("No notebooks entered; scope unchanged.", "info");
      return false;
    }

    const { resolved, missing } = resolveNotebookInputs(notebooks, inputs);
    if (missing.length > 0) {
      ctx.ui.notify(`Unknown notebook(s): ${missing.join(", ")}`, "error");
      return false;
    }

    if (target === "session" && global.allowedNotebooks && global.allowedNotebooks.length > 0) {
      if (!isSubsetById(resolved, global.allowedNotebooks)) {
        ctx.ui.notify(
          `Session scope must be a subset of global scope: ${global.allowedNotebooks.map((n) => n.title).join(", ")}`,
          "error"
        );
        return false;
      }
    }

    const preview = resolved.map((r) => `- ${r.title} (${r.id})`).join("\n");
    const confirm = await ctx.ui.select(
      `Save ${target} notebook scope?\n${preview}`,
      ["Cancel", "Save"]
    );
    if (confirm !== "Save") {
      ctx.ui.notify("Scope unchanged.", "info");
      return false;
    }

    if (target === "global") {
      const next = { ...global, allowedNotebooks: resolved };
      await saveGlobalConfig(next);
    } else {
      myConfig = { ...myConfig, allowedNotebooks: resolved };
      persistSessionConfig();
    }

    await applyScopeFromConfig();
    registerAllTools();
    ctx.ui.notify(`${target === "global" ? "Global" : "Session"} notebook scope saved.`, "info");
    return true;
  }

  async function showScope(ctx: { ui: { notify: (msg: string, level?: string) => void } }) {
    const global = await loadGlobalConfig();
    const globalSummary = formatScopeSummary(global.allowedNotebooks);
    const sessionSummary = formatScopeSummary(myConfig.allowedNotebooks);
    const effective = scopeFailClosed
      ? client.getScopeSummary()
      : formatScopeSummary(effectiveRoots);

    ctx.ui.notify(
      [
        `Global: ${globalSummary}`,
        `Session: ${sessionSummary}`,
        `Effective: ${effective}`,
      ].join("\n"),
      "info"
    );
  }

  function registerAllTools() {
    const scopeNote = scopeDescriptionSuffix();

    pi.registerTool({
      name: "joplin_list_notebooks",
      label: "List Notebooks",
      description: "List all notebooks in Joplin" + scopeNote,
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
      name: "joplin_list_tags",
      label: "List Tags",
      description: "List all tags in Joplin" + scopeNote,
      parameters: Type.Object({}),
      async execute() {
        const tags = await client.listTags();

        const output = JSON.stringify(tags, null, 2);
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
          details: { count: tags.length },
        };
      },
    });

    pi.registerTool({
      name: "joplin_list_notes",
      label: "List Notes",
      description:
        "List notes. Can filter by notebook, tag, or both simultaneously. Also supports filtering by type." +
        scopeNote,
      parameters: Type.Object({
        notebook: Type.Optional(Type.String({ description: "Notebook ID or name to filter by." })),
        tag: Type.Optional(Type.String({ description: "Tag name to filter by." })),
        type: Type.Optional(
          Type.Union(
            [
              Type.Literal("all"),
              Type.Literal("notes"),
              Type.Literal("todos"),
              Type.Literal("completed_todos"),
            ],
            { description: "Filter by note type. If omitted, returns notes and incomplete to-dos." }
          )
        ),
        page: Type.Optional(
          Type.Number({
            description: "Page number to fetch (1-indexed). Use if previous result indicated more pages.",
          })
        ),
      }),
      async execute(_id, params) {
        let notes;
        const page = params.page || 1;

        if (params.notebook && params.tag) {
          const [byNotebook, byTag] = await Promise.all([
            client.listNotes(params.notebook, params.type as any, page),
            client.listNotesByTag(params.tag, params.type as any, page),
          ]);
          const tagNoteShortIds = byTag.notes.map((n) => n.id);
          notes = {
            notes: byNotebook.notes.filter((n) =>
              tagNoteShortIds.some((shortId) => n.id.startsWith(shortId))
            ),
            has_more: byNotebook.has_more || byTag.has_more,
          };
        } else if (params.tag) {
          notes = await client.listNotesByTag(params.tag, params.type as any, page);
        } else {
          notes = await client.listNotes(params.notebook, params.type as any, page);
        }

        const output = JSON.stringify(notes, null, 2);
        const truncation = truncateHead(output, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let text = truncation.content;
        if (truncation.truncated) {
          text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines. Query specific notebooks, tags, or use 'page' parameter to fetch more.]`;
        }

        return {
          content: [{ type: "text", text }],
          details: { count: notes.notes.length, has_more: notes.has_more, page },
        };
      },
    });

    pi.registerTool({
      name: "joplin_read_note",
      label: "Read Note",
      description: "Read the content of a specific note" + scopeNote,
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
      name: "joplin_add_tag_to_note",
      label: "Add Tag to Note",
      description:
        "Add a tag to a note by its exact ID or title. Requires Human-in-the-Loop approval." + scopeNote,
      parameters: Type.Object({
        note: Type.String({ description: "Note ID or title to tag" }),
        tag: Type.String({ description: "Tag ID or title to add" }),
      }),
      async execute(_id, params) {
        await client.addTagToNote(params.tag, params.note);
        return {
          content: [
            {
              type: "text",
              text: `Successfully added tag '${params.tag}' to note '${params.note}'`,
            },
          ],
          details: {},
        };
      },
    });

    pi.registerTool({
      name: "joplin_remove_tag_from_note",
      label: "Remove Tag from Note",
      description:
        "Remove a tag from a note by its exact ID or title. Requires Human-in-the-Loop approval." +
        scopeNote,
      parameters: Type.Object({
        note: Type.String({ description: "Note ID or title" }),
        tag: Type.String({ description: "Tag ID or title to remove" }),
      }),
      async execute(_id, params) {
        await client.removeTagFromNote(params.tag, params.note);
        return {
          content: [
            {
              type: "text",
              text: `Successfully removed tag '${params.tag}' from note '${params.note}'`,
            },
          ],
          details: {},
        };
      },
    });

    pi.registerTool({
      name: "joplin_get_note_metadata",
      label: "Get Note Metadata",
      description:
        "Get metadata for a specific note (e.g. parent_id, created_time, is_todo, etc.)" + scopeNote,
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

    pi.registerTool({
      name: "joplin_move_note",
      label: "Move Note",
      description:
        "Move a note to a different notebook. Requires Human-in-the-Loop approval." + scopeNote,
      parameters: Type.Object({
        note: Type.String({ description: "Note ID or title to move" }),
        notebook: Type.String({ description: "Destination Notebook ID or title" }),
      }),
      async execute(_id, params) {
        await client.moveNote(params.note, params.notebook);
        return {
          content: [
            {
              type: "text",
              text: `Successfully moved note '${params.note}' to notebook '${params.notebook}'`,
            },
          ],
          details: {},
        };
      },
    });

    pi.registerTool({
      name: "joplin_create_note",
      label: "Create Note",
      description:
        `Create a new note or todo. Automatically tags it with '${AI_CREATED_NOTE_TAG}'. Requires Human-in-the-Loop approval.` +
        (client.isScoped()
          ? " notebook parameter is required when notebook scope is active."
          : "") +
        scopeNote,
      parameters: Type.Object({
        title: Type.String({ description: "Title of the new note/todo" }),
        type: Type.Union([Type.Literal("note"), Type.Literal("todo")], {
          description: "Whether to create a note or a todo",
        }),
        body: Type.Optional(Type.String({ description: "Markdown body content" })),
        notebook: Type.Optional(
          Type.String({ description: "Optional destination notebook ID or title" })
        ),
      }),
      async execute(_id, params) {
        const result = await client.createNote({
          title: params.title,
          type: params.type as "note" | "todo",
          body: params.body,
          notebookIdOrName: params.notebook,
          tags: [AI_CREATED_NOTE_TAG],
        });
        return {
          content: [
            {
              type: "text",
              text: `Successfully created ${params.type} '${params.title}'. ID: ${result.id}. Tagged with '${AI_CREATED_NOTE_TAG}'.`,
            },
          ],
          details: { id: result.id, tags: [AI_CREATED_NOTE_TAG] },
        };
      },
    });

    pi.registerTool({
      name: "joplin_edit_note",
      label: "Edit Note",
      description:
        "Edit an existing note's title, body, or type. Requires Human-in-the-Loop approval." +
        scopeNote,
      parameters: Type.Object({
        note: Type.String({ description: "Note ID or title to edit" }),
        title: Type.Optional(Type.String({ description: "New title" })),
        body: Type.Optional(Type.String({ description: "New markdown body content" })),
        type: Type.Optional(
          Type.Union([Type.Literal("note"), Type.Literal("todo")], {
            description: "Change type to note or todo",
          })
        ),
      }),
      async execute(_id, params) {
        await client.editNote(params.note, {
          title: params.title,
          body: params.body,
          type: params.type as "note" | "todo" | undefined,
        });
        return {
          content: [{ type: "text", text: `Successfully edited note '${params.note}'` }],
          details: {},
        };
      },
    });

    pi.registerTool({
      name: "joplin_set_todo_completion",
      label: "Set Todo Completion",
      description:
        "Mark a todo as completed or uncompleted. Requires Human-in-the-Loop approval." + scopeNote,
      parameters: Type.Object({
        note: Type.String({ description: "Note ID or title of the todo" }),
        completed: Type.Boolean({ description: "True to mark completed, false to uncomplete" }),
      }),
      async execute(_id, params) {
        await client.setTodoCompletion(params.note, params.completed);
        const status = params.completed ? "completed" : "uncompleted";
        return {
          content: [
            {
              type: "text",
              text: `Successfully marked todo '${params.note}' as ${status}`,
            },
          ],
          details: {},
        };
      },
    });
  }

  // Initial tool registration (descriptions without scope until session_start)
  registerAllTools();

  pi.on("session_start", async (_event, ctx) => {
    myConfig = {};
    // Reconstruct configuration from session
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "joplin-config") {
        myConfig = entry.data as SessionJoplinConfig;
      }
    }
    await reloadClient();
  });

  pi.on("tool_call", async (event, ctx) => {
    // 1. Allow read-only tools to bypass HIL automatically
    const readOnlyTools = [
      "joplin_list_notebooks",
      "joplin_list_tags",
      "joplin_list_notes",
      "joplin_read_note",
      "joplin_get_note_metadata",
    ];

    if (readOnlyTools.includes(event.toolName)) {
      return; // Proceed normally without prompting
    }

    // 2. Check Session Allowlist
    if (myConfig.allowedTools?.includes(event.toolName)) {
      return;
    }

    // 3. Check Global Allowlist
    const globalAllowlist = await getGlobalAllowedTools();
    if (globalAllowlist.includes(event.toolName)) {
      return;
    }

    // 4. Intercept modifying/destructive tools
    if (event.toolName.startsWith("joplin_")) {
      const actionDesc = `${event.toolName.replace("joplin_", "").replace(/_/g, " ")}\nArgs: ${JSON.stringify(event.input)}`;

      // Prompt the user in the Terminal UI
      const choice = await ctx.ui.select(
        `Joplin Modification Requested: ${actionDesc}\nAllow?`,
        ["No", "Once", "Session", "Always"]
      );

      // If the user clicks "No" or hits Escape, block the tool
      if (!choice || choice === "No") {
        return { block: true, reason: "The user denied permission for this action." };
      }

      if (choice === "Session") {
        myConfig.allowedTools = myConfig.allowedTools || [];
        myConfig.allowedTools.push(event.toolName);
        persistSessionConfig();
      } else if (choice === "Always") {
        await addGlobalAllowedTool(event.toolName);
      }

      // "Once" does nothing extra, just returns.
    }
  });

  pi.registerCommand("joplin-config", {
    description: "Configure Joplin CLI connection settings",
    handler: async (_args, ctx) => {
      const global = await loadGlobalConfig();
      const currentProfile =
        myConfig.profilePath || global.profilePath || process.env.JOPLIN_PROFILE_PATH || "";

      const profilePath = await ctx.ui.input(
        "Enter Joplin profile path (leave empty for default):",
        currentProfile
      );
      const apiToken = await ctx.ui.input(
        "Enter Joplin Web Clipper API Token (leave empty to auto-discover):",
        myConfig.apiToken || ""
      );

      myConfig = {
        ...myConfig,
        profilePath: profilePath || undefined,
        apiToken: apiToken || undefined,
      };

      // Persist profilePath to global config when provided (never store apiToken globally)
      if (profilePath) {
        const nextGlobal = { ...global, profilePath };
        await saveGlobalConfig(nextGlobal);
      }

      persistSessionConfig();
      await reloadClient();
      ctx.ui.notify("Joplin configuration updated and saved to session", "info");

      const configureScope = await ctx.ui.select(
        "Configure notebook scope now?",
        ["No", "Set global scope", "Set session scope"]
      );
      if (configureScope === "Set global scope") {
        await promptAndSetScope(ctx as any, "global");
      } else if (configureScope === "Set session scope") {
        await promptAndSetScope(ctx as any, "session");
      }
    },
  });

  pi.registerCommand("joplin-scope", {
    description: "View or change Joplin notebook access scope",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Joplin notebook scope", [
        "Show",
        "Set global",
        "Set session",
        "Clear session",
        "Clear global",
        "Cancel",
      ]);

      if (!choice || choice === "Cancel") return;

      if (choice === "Show") {
        await showScope(ctx as any);
        return;
      }

      if (choice === "Set global") {
        await promptAndSetScope(ctx as any, "global");
        return;
      }

      if (choice === "Set session") {
        await promptAndSetScope(ctx as any, "session");
        return;
      }

      if (choice === "Clear session") {
        const confirm = await ctx.ui.select("Clear session notebook scope?", ["Cancel", "Clear"]);
        if (confirm !== "Clear") return;
        delete myConfig.allowedNotebooks;
        persistSessionConfig();
        await applyScopeFromConfig();
        registerAllTools();
        ctx.ui.notify("Session notebook scope cleared.", "info");
        return;
      }

      if (choice === "Clear global") {
        const confirm = await ctx.ui.select(
          "Clear GLOBAL notebook scope? This removes the machine-wide hard limit.",
          ["Cancel", "Clear global"]
        );
        if (confirm !== "Clear global") return;
        const global = await loadGlobalConfig();
        delete global.allowedNotebooks;
        await saveGlobalConfig(global);
        await applyScopeFromConfig();
        registerAllTools();
        ctx.ui.notify("Global notebook scope cleared.", "info");
      }
    },
  });
}
