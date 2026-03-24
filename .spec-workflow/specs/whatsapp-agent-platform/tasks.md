# Tasks Document

- [-] 1. Bootstrap the Go platform workspace and API entrypoint
  - File: `go.mod`
  - File: `cmd/api-server/main.go`
  - File: `internal/platform/app.go`
  - Create the base Go module, wire the API server startup path, and define the top-level application assembly.
  - Purpose: Establish the executable backend skeleton for the platform.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `refer/whatsmeow/README.md`_
  - _Requirements: 1, 2, 3, 4, 5, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Go Platform Engineer | Task: Create the initial Go workspace and API entrypoint in `go.mod`, `cmd/api-server/main.go`, and `internal/platform/app.go` so the backend can boot with a clean module and application wiring aligned with the design document | Restrictions: Do not introduce business logic, do not hardcode environment-specific secrets, keep file responsibilities narrow | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `refer/whatsmeow/README.md` | _Requirements: 1, 2, 3, 4, 5, 6 | Success: The Go module resolves, the API entrypoint compiles, and the app assembly cleanly initializes shared dependencies without feature-specific logic. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [-] 2. Add shared configuration and HTTP server scaffolding
  - File: `internal/config/config.go`
  - File: `internal/platform/http.go`
  - File: `internal/platform/logging.go`
  - Implement typed environment-driven configuration, HTTP server setup, and structured logging bootstrap.
  - Purpose: Provide stable runtime plumbing before feature modules are added.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`_
  - _Requirements: 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Infrastructure Engineer | Task: Create typed configuration loading, HTTP server bootstrapping, and structured logging in `internal/config/config.go`, `internal/platform/http.go`, and `internal/platform/logging.go` according to the design | Restrictions: Do not mix domain logic into infrastructure files, keep configuration validation explicit, and avoid premature framework abstraction | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md` | _Requirements: 6 | Success: The server can start with validated config, logging is structured, and HTTP lifecycle wiring is isolated from application features. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [-] 3. Create the initial database migration for accounts and session credentials
  - File: `deploy/migrations/0001_accounts_and_sessions.sql`
  - File: `internal/storage/migrations.go`
  - Define the first migration and migration runner integration for accounts and encrypted session credential storage.
  - Purpose: Establish persistent state for account lifecycle and WhatsApp device credentials.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `refer/whatsmeow/README.md`_
  - _Requirements: 1, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Database Engineer | Task: Create the initial SQL migration and migration wiring for accounts and session credentials in `deploy/migrations/0001_accounts_and_sessions.sql` and `internal/storage/migrations.go` | Restrictions: Do not bundle unrelated tables into this migration, enforce primary and unique keys explicitly, and keep reversible migration structure in mind | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `refer/whatsmeow/README.md` | _Requirements: 1, 6 | Success: The schema for accounts and session credentials exists, migrations can be executed from the backend, and constraints support safe session persistence. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [-] 4. Implement account and credential repositories
  - File: `internal/accounts/repository.go`
  - File: `internal/sessions/credential_repository.go`
  - File: `internal/storage/postgres.go`
  - Add typed PostgreSQL repository methods for account records and encrypted credential blobs.
  - Purpose: Give session and API layers a clean persistence boundary.
  - _Leverage: `deploy/migrations/0001_accounts_and_sessions.sql`, `.spec-workflow/specs/whatsapp-agent-platform/design.md`_
  - _Requirements: 1, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Go Backend Engineer | Task: Implement PostgreSQL repositories for accounts and session credentials in `internal/accounts/repository.go`, `internal/sessions/credential_repository.go`, and `internal/storage/postgres.go` | Restrictions: Do not leak SQL details into handlers, keep encryption boundaries explicit, and make repository methods context-aware | _Leverage: `deploy/migrations/0001_accounts_and_sessions.sql`, `.spec-workflow/specs/whatsapp-agent-platform/design.md` | _Requirements: 1, 6 | Success: Account and credential state can be created, updated, and queried through typed repositories without coupling callers to SQL implementation details. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [x] 5. Build the whatsmeow session manager and credential store adapter
  - File: `internal/sessions/manager.go`
  - File: `internal/sessions/whatsmeow_store.go`
  - File: `cmd/session-gateway/main.go`
  - Integrate `whatsmeow` session initialization, QR or pairing generation, credential updates, and reconnect handling.
  - Purpose: Make WhatsApp account connectivity real instead of theoretical.
  - _Leverage: `refer/whatsmeow/README.md`, `.spec-workflow/specs/whatsapp-agent-platform/design.md`_
  - _Requirements: 1_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Go Protocol Engineer | Task: Build the `whatsmeow` session manager, credential store adapter, and gateway entrypoint in `internal/sessions/manager.go`, `internal/sessions/whatsmeow_store.go`, and `cmd/session-gateway/main.go` | Restrictions: Do not store credentials unencrypted, do not bury reconnect policy in handlers, and keep protocol-specific types isolated behind session module interfaces | _Leverage: `refer/whatsmeow/README.md`, `.spec-workflow/specs/whatsapp-agent-platform/design.md` | _Requirements: 1 | Success: The gateway can initialize sessions, emit pairing state, persist credential updates, and report connection transitions through a stable internal API. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [-] 6. Expose account lifecycle APIs
  - File: `internal/accounts/service.go`
  - File: `internal/accounts/handler.go`
  - File: `internal/platform/router.go`
  - Add APIs for account creation, pairing start, status lookup, and logout.
  - Purpose: Allow the admin UI to manage WhatsApp accounts through supported backend endpoints.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `internal/sessions/manager.go`_
  - _Requirements: 1, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: API Engineer | Task: Implement account lifecycle services and HTTP handlers in `internal/accounts/service.go`, `internal/accounts/handler.go`, and `internal/platform/router.go` for create, pair, status, and logout flows | Restrictions: Do not access repositories directly from handlers, validate request payloads, and return operator-readable failure states | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `internal/sessions/manager.go` | _Requirements: 1, 6 | Success: The backend exposes stable account lifecycle endpoints backed by services rather than ad hoc handler logic. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [-] 7. Create the chat, contact, message, and media schema migration
  - File: `deploy/migrations/0002_chat_history.sql`
  - File: `internal/ingest/models.go`
  - Define schema and model types for normalized chat history persistence.
  - Purpose: Prepare durable storage for conversation archival and export.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `refer/whatsmeow/README.md`_
  - _Requirements: 2, 3, 4_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Database and Data Modeling Engineer | Task: Create the normalized chat history migration and corresponding Go model definitions in `deploy/migrations/0002_chat_history.sql` and `internal/ingest/models.go` | Restrictions: Do not collapse all event data into opaque blobs only, preserve deduplication fields, and keep media metadata separate from message text content | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `refer/whatsmeow/README.md` | _Requirements: 2, 3, 4 | Success: Core chat entities have a normalized schema that supports archival, search, export, and media linkage without overloading a single table. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [-] 8. Implement the message normalization and ingest pipeline
  - File: `internal/ingest/normalizer.go`
  - File: `internal/ingest/service.go`
  - File: `internal/ingest/repository.go`
  - Convert raw `whatsmeow` events into normalized records and persist them idempotently.
  - Purpose: Make the platform a trustworthy source of chat history.
  - _Leverage: `refer/whatsmeow/README.md`, `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `deploy/migrations/0002_chat_history.sql`_
  - _Requirements: 2, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Ingestion Pipeline Engineer | Task: Implement raw-event normalization, idempotent persistence, and repository operations in `internal/ingest/normalizer.go`, `internal/ingest/service.go`, and `internal/ingest/repository.go` | Restrictions: Do not trust protocol payloads blindly, do not create duplicate messages on retries, and keep normalization rules testable outside network code | _Leverage: `refer/whatsmeow/README.md`, `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `deploy/migrations/0002_chat_history.sql` | _Requirements: 2, 6 | Success: Incoming protocol events are normalized and stored without duplicate history rows, with clear seams for later media and receipt handling. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [x] 9. Wire live session events into the ingest service
  - File: `internal/sessions/event_bridge.go`
  - File: `internal/sessions/manager.go`
  - Connect active `whatsmeow` sessions to the ingest pipeline and publish live update events.
  - Purpose: Close the loop between protocol events and archived application state.
  - _Leverage: `internal/ingest/service.go`, `refer/whatsmeow/README.md`_
  - _Requirements: 1, 2, 3_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Event-Driven Systems Engineer | Task: Connect session-level WhatsApp events to the ingest service through `internal/sessions/event_bridge.go` and update `internal/sessions/manager.go` to emit stable internal events | Restrictions: Do not let transport callbacks write directly to the database, avoid circular package dependencies, and preserve backpressure-friendly behavior | _Leverage: `internal/ingest/service.go`, `refer/whatsmeow/README.md` | _Requirements: 1, 2, 3 | Success: Live WhatsApp events flow from active sessions into the normalized ingest path and can fan out updates to other platform modules. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [-] 10. Add chat list and message history query APIs
  - File: `internal/chats/service.go`
  - File: `internal/chats/handler.go`
  - File: `internal/chats/repository.go`
  - Implement paginated chat and message retrieval with search filters.
  - Purpose: Support the operator conversation workspace.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `internal/ingest/models.go`_
  - _Requirements: 3_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Query API Engineer | Task: Implement chat list, message history, and search retrieval in `internal/chats/service.go`, `internal/chats/handler.go`, and `internal/chats/repository.go` | Restrictions: Do not fetch entire histories in one request, design cursor or pagination behavior explicitly, and keep SQL tuned for latest-message sorting | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `internal/ingest/models.go` | _Requirements: 3 | Success: Operators can query chats and message histories with pagination and filters through a clean service and handler layer. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [-] 11. Add export job schema and queue integration
  - File: `deploy/migrations/0003_exports.sql`
  - File: `internal/exports/jobs.go`
  - File: `internal/exports/repository.go`
  - Create export job persistence and queue metadata handling.
  - Purpose: Move export generation off the request path.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`_
  - _Requirements: 4, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Backend Job Systems Engineer | Task: Add export job persistence and queue-facing job logic in `deploy/migrations/0003_exports.sql`, `internal/exports/jobs.go`, and `internal/exports/repository.go` | Restrictions: Do not generate artifacts inside HTTP handlers, keep job state transitions explicit, and record failure reasons structurally | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md` | _Requirements: 4, 6 | Success: Export requests can be recorded, queued, and tracked independently of artifact rendering, with durable status transitions. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [-] 12. Implement export renderers for JSON, Markdown, and HTML
  - File: `internal/exports/render_json.go`
  - File: `internal/exports/render_markdown.go`
  - File: `internal/exports/render_html.go`
  - Build format-specific renderers for normalized chat history.
  - Purpose: Produce the actual downloadable export content for operators.
  - _Leverage: `refer/WhatsApp-Chat-Exporter/README.md`, `.spec-workflow/specs/whatsapp-agent-platform/design.md`_
  - _Requirements: 4_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Export Pipeline Engineer | Task: Implement `JSON`, `Markdown`, and `HTML` renderers in `internal/exports/render_json.go`, `internal/exports/render_markdown.go`, and `internal/exports/render_html.go` for normalized chat history and media references | Restrictions: Do not couple rendering to database access, keep format logic isolated per file, and preserve deterministic output ordering | _Leverage: `refer/WhatsApp-Chat-Exporter/README.md`, `.spec-workflow/specs/whatsapp-agent-platform/design.md` | _Requirements: 4 | Success: Each supported export format can be rendered from in-memory domain records with consistent structure and media linkage behavior. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [-] 13. Build the export worker and export APIs
  - File: `cmd/export-worker/main.go`
  - File: `internal/exports/worker.go`
  - File: `internal/exports/handler.go`
  - Connect export requests, worker execution, artifact storage, and status APIs.
  - Purpose: Make export jobs visible and usable from the platform.
  - _Leverage: `internal/exports/jobs.go`, `internal/exports/render_json.go`, `internal/exports/render_markdown.go`, `internal/exports/render_html.go`_
  - _Requirements: 4, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Asynchronous Backend Engineer | Task: Implement the export worker entrypoint, worker logic, and export API handlers in `cmd/export-worker/main.go`, `internal/exports/worker.go`, and `internal/exports/handler.go` | Restrictions: Do not hide job failures, keep artifact storage concerns separate from renderers, and expose operator-readable progress states | _Leverage: `internal/exports/jobs.go`, `internal/exports/render_json.go`, `internal/exports/render_markdown.go`, `internal/exports/render_html.go` | _Requirements: 4, 6 | Success: Operators can submit exports, observe job progress, and download completed artifacts through stable APIs and worker execution. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [x] 14. Add agent rule and agent run persistence
  - File: `deploy/migrations/0004_agents.sql`
  - File: `internal/agents/repository.go`
  - File: `internal/agents/models.go`
  - Create storage for rule definitions, run history, safety outcomes, and draft replies.
  - Purpose: Give the agent system durable configuration and audit state.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`_
  - _Requirements: 5, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Data Platform Engineer | Task: Create SQL schema and repository models for agent rules and agent runs in `deploy/migrations/0004_agents.sql`, `internal/agents/repository.go`, and `internal/agents/models.go` | Restrictions: Do not mix transient queue state with durable audit state, keep run status enums explicit, and preserve fields needed for blocked-send analysis | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md` | _Requirements: 5, 6 | Success: Agent configuration and execution history can be stored, queried, and audited independently of session or export state. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [x] 15. Build the agent rule management APIs
  - File: `internal/agents/service.go`
  - File: `internal/agents/handler.go`
  - File: `internal/platform/router.go`
  - Expose APIs to create, update, list, enable, and disable agent rules and inspect run history.
  - Purpose: Let operators configure controlled AI behavior from the web console.
  - _Leverage: `internal/agents/repository.go`, `.spec-workflow/specs/whatsapp-agent-platform/design.md`_
  - _Requirements: 5, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: API and Domain Service Engineer | Task: Implement agent rule and run management services and handlers in `internal/agents/service.go`, `internal/agents/handler.go`, and update `internal/platform/router.go` to expose the routes | Restrictions: Do not allow unsafe default auto-send behavior, validate rule payloads rigorously, and keep HTTP handlers thin | _Leverage: `internal/agents/repository.go`, `.spec-workflow/specs/whatsapp-agent-platform/design.md` | _Requirements: 5, 6 | Success: The backend exposes safe, validated agent rule management and run inspection endpoints for the admin UI. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [x] 16. Implement the Python agent runner service
  - File: `agent_runner/app.py`
  - File: `agent_runner/policy.py`
  - File: `agent_runner/providers/base.py`
  - Build the agent execution service that assembles context, applies safety policy, and calls an LLM provider adapter.
  - Purpose: Keep AI orchestration isolated from the WhatsApp protocol runtime.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`_
  - _Requirements: 5, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Python AI Platform Engineer | Task: Build the standalone agent runner service in `agent_runner/app.py`, `agent_runner/policy.py`, and `agent_runner/providers/base.py` for context assembly, safety checks, and provider abstraction | Restrictions: Do not embed provider-specific code in core policy logic, never auto-send without explicit rule approval, and keep the service callable through a clean internal API | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md` | _Requirements: 5, 6 | Success: The agent runner can accept a run request, build context, apply policy checks, and either return a draft, block the send, or prepare a dispatch request through a provider abstraction. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [x] 17. Add audit logging and system health services
  - File: `internal/audit/service.go`
  - File: `internal/audit/handler.go`
  - File: `internal/health/service.go`
  - Implement audit record creation helpers and the aggregated health status service.
  - Purpose: Give operators visibility into risky actions and broken runtime state.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`_
  - _Requirements: 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Observability and Compliance Engineer | Task: Implement audit and health services in `internal/audit/service.go`, `internal/audit/handler.go`, and `internal/health/service.go` to expose operational and compliance visibility | Restrictions: Do not log secrets or credential payloads, keep audit writes structured, and make health status actionable rather than decorative | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md` | _Requirements: 6 | Success: Sensitive actions are recorded as audit events and operators can query a meaningful health summary of sessions, queues, and worker pipelines. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [x] 18. Build the account and chat review web pages
  - File: `web/src/pages/AccountsPage.tsx`
  - File: `web/src/pages/ChatsPage.tsx`
  - File: `web/src/api/client.ts`
  - Implement the first operator UI pages for account lifecycle and chat review flows.
  - Purpose: Surface the working backend in a usable admin console.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`_
  - _Requirements: 1, 3_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend Engineer | Task: Build the initial account management and chat review pages plus typed API client wiring in `web/src/pages/AccountsPage.tsx`, `web/src/pages/ChatsPage.tsx`, and `web/src/api/client.ts` | Restrictions: Do not collapse all UI into one page, keep state flow readable, make loading, empty, and failure states explicit, and design for novice employees with plain-language labels and obvious primary actions | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md` | _Requirements: 1, 3 | Success: Operators can connect accounts, inspect connection state, browse chats, and open message history through the web console, and a newly onboarded employee can understand the page structure without protocol knowledge. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [x] 19. Build the export and agent management web pages
  - File: `web/src/pages/ExportsPage.tsx`
  - File: `web/src/pages/AgentsPage.tsx`
  - File: `web/src/components/RuleEditor.tsx`
  - Implement export submission, job tracking, and agent rule management UI.
  - Purpose: Complete the core operator workflows promised by the MVP.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `web/src/api/client.ts`_
  - _Requirements: 4, 5, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend Product Engineer | Task: Build the export management page, agent management page, and reusable rule editor component in `web/src/pages/ExportsPage.tsx`, `web/src/pages/AgentsPage.tsx`, and `web/src/components/RuleEditor.tsx` | Restrictions: Do not hide dangerous options behind unclear UI, make auto-send visibly risky, keep export and rule forms typed and validated, and explain advanced options in plain language for junior staff | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `web/src/api/client.ts` | _Requirements: 4, 5, 6 | Success: Operators can create export jobs, inspect job outcomes, configure reply rules, and review safety-related agent settings from the UI, with clear guidance that reduces misconfiguration by novice employees. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._

- [x] 20. Add end-to-end local development wiring and smoke tests
  - File: `deploy/docker/docker-compose.yml`
  - File: `tests/e2e/platform_smoke_test.md`
  - File: `README.md`
  - Add local runtime dependencies, a smoke-test checklist, and a project README that explains the current platform workflow.
  - Purpose: Make the repository runnable and understandable for future implementation work.
  - _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/requirements.md`, `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `.spec-workflow/specs/whatsapp-agent-platform/tasks.md`_
  - _Requirements: 1, 2, 3, 4, 5, 6_
  - _Prompt: Implement the task for spec whatsapp-agent-platform, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Developer Experience Engineer | Task: Create local docker-compose wiring, an end-to-end smoke-test checklist, and a repository README in `deploy/docker/docker-compose.yml`, `tests/e2e/platform_smoke_test.md`, and `README.md` | Restrictions: Do not document features that do not exist yet, keep the smoke test grounded in actual implemented flows, and make local setup instructions explicit | _Leverage: `.spec-workflow/specs/whatsapp-agent-platform/requirements.md`, `.spec-workflow/specs/whatsapp-agent-platform/design.md`, `.spec-workflow/specs/whatsapp-agent-platform/tasks.md` | _Requirements: 1, 2, 3, 4, 5, 6 | Success: A developer can understand the project, boot local dependencies, and follow a smoke-test path that matches the current implementation state. After starting, mark the task in-progress in tasks.md, log implementation details with the log-implementation tool, and then mark the task complete._
