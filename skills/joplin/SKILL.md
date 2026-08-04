---
name: joplin
description: Help the AI agent operate Joplin notes via Web Clipper API tools. Use when the user asks to list, read, create, edit, tag, move, or complete Joplin notes/todos/notebooks.
triggers:
  - joplin
  - note
  - notes
  - notebook
  - notebooks
  - todo
  - todos
  - tag
  - tags
  - clipper
---

# pi-joplin Skill

`pi-joplin` is a Pi coding-agent extension package that lets the agent read and
write Joplin notes through the desktop Web Clipper API. It exposes semantic
`joplin_*` tools and a Human-in-the-Loop gate for write operations.

## Critical Prerequisite: Do Not Start Joplin

**Default assumption: Joplin Desktop is already running, and its Web Clipper
service (API) is already enabled.**

- **Do not** start a new Joplin Desktop process.
- **Do not** launch a headless/CLI Joplin server as a substitute for the user's
  running instance.
- **Do not** run shell commands such as `joplin`, `joplin server start`, or open
  the Joplin app binary just to make tools work.
- Connect only to the already-running Web Clipper API (typically
  `http://localhost:41184` or `http://localhost:27583`).

If a `joplin_*` tool fails because the API is unreachable, tell the user to:

1. Open Joplin Desktop (if it is not already open)
2. Enable Web Clipper under Tools / Options / Web Clipper
3. Optionally re-run `/joplin-config` if the profile path or API token needs setup

Do not try to "fix" connectivity by spawning Joplin yourself.

## When to Use This Skill

Use this skill (and its `joplin_*` tools) whenever the user's request involves
their Joplin data, including:

- Listing notebooks or tags
- Finding notes by notebook, tag, or type (note / todo)
- Reading note body or metadata
- Creating notes or todos (auto-tagged `AI-Generated`)
- Editing title/body/type
- Adding or removing tags
- Moving notes between notebooks
- Marking todos completed or uncompleted

If the user asks what Joplin tools are available here, summarize the tools and
the HIL safety model below.

## Available Tools

All tool names start with `joplin_`.

### Read-only (no confirmation required)

| Tool | Purpose |
|------|---------|
| `joplin_list_notebooks` | List notebooks (respects notebook scope). |
| `joplin_list_tags` | List all tags. |
| `joplin_list_notes` | List notes; optional filters: `notebook`, `tag`, `type`, `page`. |
| `joplin_read_note` | Read note body by ID or title. |
| `joplin_get_note_metadata` | Read metadata (parent_id, is_todo, times, tags, etc.). |

### Write (requires Human-in-the-Loop confirmation)

| Tool | Purpose |
|------|---------|
| `joplin_create_note` | Create a note or todo; always tags with `AI-Generated`. |
| `joplin_edit_note` | Edit title, body, and/or type. |
| `joplin_add_tag_to_note` | Add a tag to a note. |
| `joplin_remove_tag_from_note` | Remove a tag from a note. |
| `joplin_move_note` | Move a note to another notebook. |
| `joplin_set_todo_completion` | Mark a todo completed or uncompleted. |

Write tools prompt the user with: No / Once / Session / Always.

## Configuration (user-controlled)

Connection and scope are configured by the **user** via slash commands, not by
the agent spawning processes:

- `/joplin-config` - profile path and optional API token
- `/joplin-scope` - notebook access scope (global / session)

Agent rules:

- Prefer calling `joplin_*` tools directly.
- Do not invent credentials or rewrite `~/.pi/agent/joplin.json` unless the user
  explicitly asks for a config file edit.
- If scope is fail-closed or restricted, stay inside the effective notebooks;
  you cannot widen scope yourself.

## Working Style

1. Prefer read tools first (`list_*` / `read_note` / `get_note_metadata`) to
   locate the right IDs or titles.
2. Use exact notebook/tag/note titles or IDs returned by list tools.
3. For creates, set a clear title; put long content in `body` (Markdown).
4. Expect new notes/todos to receive the `AI-Generated` tag automatically.
5. When notebook scope is active and you create a note, pass an in-scope
   `notebook` (required by the tool description in that mode).
6. If list output is truncated or `has_more` is true, pass `page` to fetch more.

## Safety

- Read tools pass through without confirmation.
- Write tools require explicit user approval in the UI.
- Never assume "Always" permission; only the user's HIL choice grants it.
- Do not batch large destructive-looking edits without explaining impact first.
