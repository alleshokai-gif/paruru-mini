# PALURU Secret Console — Phase 2 Prototype

This component is a local, synthetic-only prototype of the independent PALURU Secret Console admin plane.

It is deliberately separate from PALURU Mini runtime code. It has no production backend, cloud SDK, Apps Script integration, OAuth setup, service-account setup, external network dependency, or deployment configuration.

## Run

```powershell
cd secret-console
npm.cmd test
npm.cmd start
```

The server binds to `127.0.0.1` and prints only the local URL. Open `http://127.0.0.1:4177`.

## Prototype scope

- Four synthetic logical credentials
- Redacted list/detail/probe APIs
- Write-only staging request
- Synthetic backend with metadata-only state
- Success and verify-failure rotation paths
- Explicit Human approval before old-disable
- Rollback simulation
- In-memory redacted audit ledger
- Responsive local UI

The in-memory audit proves the application contract and failure behavior, not production durability. Authentication, durable audit storage, GAS distribution transport, dual-slot retention, and production backend selection remain Phase 3 gates.

## Security boundary

- Never enter a real credential into this prototype.
- Submitted synthetic input is not persisted by the backend, registry, rotation store, audit store, or logs.
- The UI does not reveal or represent a current value.
- No secret read/reveal/export/compare route exists.
- There are no fixtures or snapshots containing credential input.
- Restarting the process resets every synthetic state.

## API

```text
GET  /api/credentials
GET  /api/credentials/{credentialId}
POST /api/credentials/{credentialId}/stage
POST /api/credentials/{credentialId}/probe
POST /api/rotations
GET  /api/rotations/{rotationId}
POST /api/rotations/{rotationId}/distribute
POST /api/rotations/{rotationId}/verify
POST /api/rotations/{rotationId}/approve
POST /api/rotations/{rotationId}/disable-old
POST /api/rotations/{rotationId}/regression-check
POST /api/rotations/{rotationId}/rollback
```

Only the stage request accepts credential input. Every response is redacted.
