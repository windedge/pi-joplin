# pi-joplin

A pi extension that provides interactive access to Joplin notes.

## Features
- List notebooks and tags
- List notes (all notes or filtered by notebook/tag)
- Read individual notes
- Get metadata for a specific note (e.g. parent_id, is_todo, created_time, tags, etc.)
- Create and edit notes/todos (Requires Human-in-the-Loop interactive confirmation; new notes are tagged `AI-Generated`)
- Add or remove tags from notes (Requires Human-in-the-Loop interactive confirmation)
- Move notes between notebooks (Requires Human-in-the-Loop interactive confirmation)
- Mark todos completed/uncompleted (Requires Human-in-the-Loop interactive confirmation)
- Optional **notebook scope**: restrict read/write access to selected notebooks and their sub-notebooks

## Installation

Install via the `pi` CLI:

```bash
pi install npm:pi-joplin
```

## Usage

Once installed, the tools will automatically be available in your sessions. 

For local development or testing without installing globally, you can load the extension directly:

```bash
pi -e /path/to/pi-joplin/dist/index.js
```

## Requirements
- Joplin CLI must be installed or the extension will use its internal `joplin` NPM dependency.
- The `Web Clipper` must be enabled inside Joplin Desktop (or you must supply a custom API Token).

## Configuration

### Connection

If you do not use the default profile location, or if you need to manually connect to a headless background server via API token, you can invoke the configuration UI via `pi`:

```
/joplin-config
```

This will prompt you for a profile path and API token. The session stores connection overrides; `profilePath` may also be saved to the global config file. API tokens are never written to the global config file.

After connection setup, you can optionally configure notebook scope from the same command.

### Notebook scope

Limit the extension so it can only read and write notes inside selected notebooks (each entry includes that notebook and all of its sub-notebooks):

```
/joplin-scope
```

Menu actions:
- **Show** - global, session, and effective scope
- **Set global** - machine-wide hard limit (`~/.pi/agent/joplin.json`)
- **Set session** - session-only narrowing (must be a subset of global when global is set)
- **Clear session** / **Clear global**

Behavior:
- Unconfigured scope = unrestricted (previous default)
- Lists silently hide out-of-scope items; single-note read/write outside scope fails with an explicit error
- If configured notebooks are all missing (wrong profile / deleted), access fail-closes until you reconfigure
- Only you can change scope via slash commands; the agent cannot widen its own access

Global settings live in `~/.pi/agent/joplin.json` (also stores permanent tool allowlist entries from HIL "Always"). Legacy `~/.pi/agent/joplin-allowlist.json` is still read for migration.
