# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.1] - 2026-08-01

### Fixed
- pi startup no longer blocks on Joplin connection: client now initializes lazily on first tool use
- API requests, ping probes, and headless server startup now have timeouts so hangs fail fast

## [1.1.0] - 2026-07-29

### Added
- Notebook scope: restrict read/write to selected notebooks and their sub-notebooks
- `/joplin-scope` command to show, set, or clear global/session scope
- Optional scope setup from `/joplin-config` after connection settings
- Global config file `~/.pi/agent/joplin.json` (tools allowlist, profile path, notebook scope)
- Automatic `AI-Generated` tag on notes created via `joplin_create_note`

### Changed
- Migrates legacy `~/.pi/agent/joplin-allowlist.json` into `joplin.json` when present
- Package description updated to reflect scoped interactive access (not read-only)

## [1.0.0] - previous

Initial release with Joplin list/read tools, write tools with HIL, and related features.
