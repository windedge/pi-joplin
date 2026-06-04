# pi-joplin

A pi extension that provides read-only access to Joplin notes.

## Features
- List all notebooks
- List notes (all notes or filtered by notebook/tag)
- Read individual notes
- Get metadata for a specific note (e.g. parent_id, is_todo, created_time, tags, etc.)

## Usage

You can load this extension in your `pi` environment:

```bash
pi -e /path/to/pi-joplin/src/index.ts
```

Or configure it in your `~/.pi/settings.json`:
```json
{
  "extensions": [
    "/path/to/pi-joplin/src/index.ts"
  ]
}
```

## Requirements
- Joplin CLI must be installed or the extension will use its internal `joplin` NPM dependency.
- The `Web Clipper` must be enabled inside Joplin Desktop (or you must supply a custom API Token).

## Configuration

If you do not use the default profile location, or if you need to manually connect to a headless background server via API token, you can invoke the configuration UI via `pi`:

```
/joplin-config
```

This will prompt you for an API token and a profile path and persist them safely inside your active session.
