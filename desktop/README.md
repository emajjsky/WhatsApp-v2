# Windows Desktop Packaging

This folder builds the Windows desktop installer. The installer bundles:

- Electron shell
- React web build
- Go API server
- Python embeddable runtime for `agent_runner`
- PostgreSQL Windows binaries for local storage

Users do not need Docker, PostgreSQL, Go, Node.js, or Python installed.

## Build

Run from `desktop/`:

```powershell
npm install
npm run dist:win
```

The installer is written to `desktop/release/`.

The first successful `npm install` will create `desktop/package-lock.json`.
Commit that lockfile after the installer build is confirmed on the packaging
machine.

If Python or PostgreSQL download fails because of a slow network, place these
files manually before running `npm run dist:win` again:

```text
.cache/desktop/python-3.12.10-embed-amd64.zip
.cache/desktop/postgresql-16.13-1-windows-x64.exe
```

## Runtime Data

The app stores local data under the Electron user data directory:

```text
%APPDATA%/WhatsApp Agent/
```

Important subdirectories:

- `postgres-data/`: local PostgreSQL data directory
- `data/`: exported files, scripts, media cache
- `logs/`: local process logs

## Cloud Auth Plan

The first desktop cut keeps the local API and bundled local database so the Windows installer can run without Docker. The next step is to add a cloud auth proxy:

```text
desktop app -> local API -> cloud auth server
```

WhatsApp sessions and chat data remain local. Cloud only validates user registration, invite code, and license status.
