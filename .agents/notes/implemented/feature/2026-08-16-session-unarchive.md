# Agent Note: GUI session unarchive

Status: implemented

English | [中文](2026-08-16-session-unarchive.zh.md)

## Problem

The archive-session feature (row menu → `workspace.archiveSession` → registry-global durable set) hid sessions from every grouping surface with no way back: the client had no view of archived rows and no unarchive control, so a session archived by mistake (or by experiment) became unreachable from the GUI even though its log and workspace slot were intact. The persisted set could only be edited by hand in `$DSH_HOME/storages/workspace.json` while the host was stopped.

## Decision

The fork ships a complete unarchive round trip:

- **Host**: `workspaceRegistry.unarchiveSession(sessionId)` removes the id from the durable `archivedSessionIds` set (idempotent for a non-member — the set is the only fact consulted, so no session existence check is needed). The new `workspace.unarchiveSession` RPC mirrors `archiveSession` (request `{ sessionId }`, response the full updated set) with no business-error path; the existing `host/archived-sessions-changed` frame fires automatically through the `domain/changed` listener, so clients already subscribed re-baseline without a new frame type.
- **Client runtime**: `WorkspaceRuntime.unarchiveSession` mirrors `archiveSession` through the same manager echo-install path (`installArchived`), so the local unary echo, another tab's frame, and reconnect baselines all converge.
- **UI**: archived rows become visible in a bottom **archived section** (`deriveArchived`: registry-archived sessions, subagent-origin and blank placeholders excluded, newest-first) rendered under the grouped tree and the flat list whenever the set is non-empty. The section is **collapsed by default**; its header toggle (an `archivedExpanded` flag in the browser's persisted viewing store, shared across the grouped and flat surfaces) expands it. Expanded rows keep their hover affordances; the row menu offers only the **Unarchive session** verb (rename/fork/archive target visible sessions), dimmed via a dedicated row class. Search keeps excluding archived members.

## Alternatives considered

### Editing the persisted state file to restore sessions

Works for a one-off rescue (remove ids from `workspace.json` with the host stopped), but it is not a product: it requires stopping the GUI, offers no per-session granularity, and every future archive needs the same hand surgery. The GUI entry is the durable fix and the fork's user explicitly asked for it.

### A standalone unarchive dialog without an archived-sessions view

An unarchive verb needs a target; archived rows are hidden from every existing surface by design. A dialog listing hidden sessions would duplicate the tree machinery for one action. The archived section reuses the existing row component and its hover/menu affordances for both viewing and unarchiving.

### Showing archived rows inline, dimmed, inside their original groups

Keeps the workspace grouping intact but complicates every derivation (`deriveGroups`, `deriveFlat`, search, counts, drag) with an extra visibility axis, and mixes hidden content into the live tree. A dedicated bottom section keeps the hidden state visually and structurally separate while the accounting slot still restores the row on unarchive.

## Consequences

- The section appears only when the set is non-empty and starts collapsed, so existing GUI snapshots and compositions without archived sessions are unchanged.
- Opening an archived row still works (the session log is untouched); only grouping hides it.
- Unarchiving is a no-op for non-members, so stale clients racing the set cannot fail the call.
- The GUI-debt coverage exemption for `WorkspaceBrowser.tsx` means the section's render wiring is covered by component and browser e2e tests rather than per-file coverage; the derivation (`tree.ts`) and row menu (`Rows.tsx`) are fully covered.
