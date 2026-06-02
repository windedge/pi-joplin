# pi-joplin

A pi extension that provides read-only access to Joplin notes.

## Features
- List all notebooks
- List notes (all notes or filtered by notebook)
- Read individual notes
- List notes by a specific tag

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
- Joplin data must be accessible to the executing user.
