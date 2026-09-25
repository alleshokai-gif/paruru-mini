# PALURU Shell Migration Direction

Date: 2026-09-25

## Decision

PALURU should move away from continued monolithic expansion toward a lightweight shell + independent views/apps architecture.

## Why

The current PWA has accumulated multiple concerns in one place: Home, memo input, authentication, legacy compatibility, GAS reads/writes, Cloud Run direct reads, Bus, Kaz OS, Nurse Okan, Popio, etc. The visible symptom is growing UI/maintenance complexity and latency, especially around PALURU Memo.

## Direction

- Keep a lightweight PALURU shell responsible for:
  - top PALURU header
  - drawer
  - bottom navigation
  - authentication/session
- Move features into independently replaceable views/modules/apps:
  - Home
  - PALURU Memo
  - Bus
  - Infection Watch
  - Popio
  - Nurse Okan
  - Kaz OS
- Prefer Direct Read paths for display-oriented data access where practical.
- Keep GAS only where it is still justified, especially writes or legacy compatibility.
- Do not perform a big-bang rewrite.
- Use a strangler-style migration, moving one feature at a time.
- First migration candidate: PALURU Memo, because current perceived latency is unacceptable.
- Before redesigning Memo, instrument the path from tap/input to save completion and split latency into auth, transport, backend, and redraw/reload costs.
- Suggested acceptance target for the new Memo path:
  - input is immediately interactive
  - save feels around the 1-second range where feasible
  - saving does not trigger a full Home reload
- Infection Watch should eventually become a native PALURU view using its data/API rather than iframe embedding or a separate browser page.

## Notes

The intent is not to "rewrite PALURU" but to make PALURU behave more like an OS/portal shell whose internal apps can be replaced independently.
