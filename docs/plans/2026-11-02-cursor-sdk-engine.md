# Cursor SDK Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `@cursor/sdk` as an optional local Halo agent engine with no Python process or private harness protocol.

**Architecture:** `services/agent/cursor/` adapts Cursor's public `Agent` and `Run` APIs to Halo's V2 session and canonical message protocol. The package is dynamically imported only when Cursor is selected, stays outside the fallback order, and uses Cursor's local runtime with Halo's working directory. Halo-owned in-process MCP tools become Cursor custom tools; external MCP records use Cursor's native MCP configuration.

**Tech Stack:** TypeScript, `@cursor/sdk`, Electron/Node, Vitest.

### Task 1: Optional package and engine registration

1. Add failing tests for the `cursor` engine id, opt-in fallback behavior, package availability, and direct SDK loading.
2. Add `@cursor/sdk` as an optional dependency and unpack its platform runtime in packaged applications.
3. Probe the package entry without importing the SDK; authentication remains the SDK's responsibility.
4. Dynamically import `@cursor/sdk` only when Cursor is selected.
5. Run the registration and availability tests.

### Task 2: Option and MCP translation

1. Add failing tests for local cwd/model/auth options, external stdio/HTTP MCP records, Halo in-process tools, and disabled-tool handling.
2. Translate Halo in-process MCP tools to `local.customTools`, preserving schemas, annotations, results, and server-qualified names.
3. Pass external servers through `mcpServers`; fail closed by omitting a server when Cursor cannot enforce its per-tool disables.
4. Keep ambient Cursor setting sources disabled and seed Halo's host context once while retaining Cursor's native agent guidance.
5. Run the option tests.

### Task 3: Event normalization

1. Add failing tests for assistant text, thinking, tool start/result, usage, cancellation, errors, and exactly one terminal result.
2. Normalize `SDKMessage` values into Halo's `system.init`, `stream_event`, aggregate `assistant`, `user.tool_result`, and `result` frames.
3. Map Cursor tool names to Halo's engine-neutral card kinds.
4. Run the normalizer tests.

### Task 4: V2 session adapter

1. Add failing tests for create/resume, per-turn streaming, cancellation, disposal, and one-time host context.
2. Implement one persistent Cursor `Agent` per Halo session and one Cursor `Run` per Halo turn.
3. Delegate interruption to `run.cancel()`, resume through `Agent.resume()`, and always dispose the agent.
4. Expose Halo's liveness and supported-command shims.
5. Run the session tests.

### Task 5: Safety, docs, and verification

1. Keep `permissionRules: false`; delegated guest/team turns must be refused by Halo's existing capability gate.
2. Document auth, model selection (`HALO_CURSOR_MODEL`, default `auto`), resume, MCP behavior, and unsupported policy features.
3. Run Cursor-focused tests, changed-file type checks, architecture checks, and the production build.
4. If `CURSOR_API_KEY` or a stored SDK login is present, perform a local SDK smoke turn without logging credentials; otherwise record that live validation was skipped.
