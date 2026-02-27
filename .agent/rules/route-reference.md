# Route Reference: CodeRed

**Last Updated**: 2026-02-21  
**Governance**: See [api-architecture.md](file://./api-architecture.md)  
**Architecture**: See [docs/architecture.md](file:///Users/gonzo/Code/code-red/docs/architecture.md) §4

---

## Domain Map

CodeRed's API serves two contexts: the **Tauri desktop** (via in-process Rust commands) and the **Fastify web server** (via HTTP).

### Bounded Contexts

| Context | Namespace | Purpose |
|---|---|---|
| **Comparisons** | `/api/comparisons` | CRUD for comparison runs |
| **Exhibits** | `/api/exhibits` | Export and retrieval of Exhibit A/B/C artifacts |
| **Audit** | `/api/audit` | Read-only access to the investigation audit trail |
| **Engine** | `/api/engine` | Engine health, grammar listing, settings |

---

## Target Route Structure

### Comparisons Domain (`/api/comparisons/`)

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/comparisons` | Create new comparison run |
| `GET` | `/api/comparisons/:id` | Get comparison status/results |
| `GET` | `/api/comparisons/:id/manifest` | Get file manifest (hashes, sizes) |
| `GET` | `/api/comparisons/:id/matches` | Get match results |
| `GET` | `/api/comparisons/:id/diffs/:fileId` | Get diff for specific file pair |

### Exhibits Domain (`/api/exhibits/`)

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/exhibits/:comparisonId/generate` | Generate exhibit pack |
| `GET` | `/api/exhibits/:id` | Download exhibit (PDF/ZIP) |
| `GET` | `/api/exhibits/:id/manifest` | Get exhibit reproducibility manifest |

### Audit Domain (`/api/audit/`)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/audit/events` | List audit events (filterable) |
| `GET` | `/api/audit/events/:id` | Get single audit event |

### Engine Domain (`/api/engine/`)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/engine/health` | Engine heartbeat |
| `GET` | `/api/engine/grammars` | List supported Tree-sitter grammars |
| `GET` | `/api/engine/settings` | Get current engine settings |

---

## Registry

| Resource | Prefix | Owner File | Status |
|----------|--------|------------|--------|
| Comparison | `/api/comparisons` | `apps/web/src/routes/comparisons.ts` | Planned |
| Exhibit | `/api/exhibits` | `apps/web/src/routes/exhibits.ts` | Planned |
| Audit | `/api/audit` | `apps/web/src/routes/audit.ts` | Planned |
| Engine | `/api/engine` | `apps/web/src/routes/engine.ts` | Planned |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-21 | Initial CodeRed route reference created |
