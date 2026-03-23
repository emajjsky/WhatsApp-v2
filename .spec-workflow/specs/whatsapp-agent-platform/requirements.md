# Requirements Document

## Introduction

`whatsapp-agent-platform` is a self-hosted platform built on top of the `whatsmeow` multi-device WhatsApp protocol library. The platform enables operators to connect one or more WhatsApp accounts, continuously archive chat records, export conversations in multiple formats, and configure AI agents to generate or automatically send replies under controlled rules.

The purpose of this feature is to turn scattered WhatsApp automation experiments into a single operator-facing platform with clear session management, reliable message ingestion, searchable chat history, governed export workflows, and auditable agent-assisted reply flows.

## Alignment with Product Vision

There are currently no steering documents in `.spec-workflow/steering/`. This spec therefore defines the initial product direction for the project:

- Build a practical WhatsApp operations platform around `whatsmeow` rather than a one-off bot.
- Prioritize durable chat archival and operator control before advanced automation.
- Treat agent auto-reply as a governed capability with visibility, limits, and auditability rather than an unchecked bulk messaging tool.
- Keep the architecture modular so protocol connectivity, storage, export, and agent orchestration can evolve independently.

## Requirements

### Requirement 1

**User Story:** As a platform operator, I want to connect and manage WhatsApp accounts through `whatsmeow`, so that the platform can ingest messages from linked devices without relying on browser automation.

#### Acceptance Criteria

1. WHEN an operator creates a new WhatsApp account connection THEN the system SHALL create a dedicated session record and provide a QR-code or pairing flow for device linking.
2. WHEN a linked account completes pairing THEN the system SHALL persist the session state and mark the account as connected.
3. IF a session disconnects unexpectedly THEN the system SHALL record the disconnect reason, expose the current status in the platform, and attempt recovery according to configured reconnect rules.
4. WHEN an operator explicitly logs out an account THEN the system SHALL revoke the local session state and prevent further message processing for that account.

### Requirement 2

**User Story:** As an operations user, I want incoming and outgoing WhatsApp conversations to be continuously archived, so that the platform becomes a reliable source of chat history.

#### Acceptance Criteria

1. WHEN a text, media, reaction, receipt, or chat metadata event is received from a connected account THEN the system SHALL normalize and persist the event under the correct account, chat, and participant.
2. WHEN media content is referenced by a supported message type THEN the system SHALL store the metadata required to retrieve or export the media asset and retain the storage location or retrieval status.
3. IF the same protocol event is delivered more than once THEN the system SHALL deduplicate it without creating duplicate chat history records.
4. WHEN the platform restarts THEN the system SHALL resume message ingestion for valid active sessions without losing previously archived records.

### Requirement 3

**User Story:** As a support or operations user, including newly onboarded employees, I want to browse and search archived WhatsApp chats in the platform UI, so that I can review conversation context before replying or exporting data without needing protocol knowledge or training-heavy workflows.

#### Acceptance Criteria

1. WHEN a user opens the conversation workspace THEN the system SHALL display the list of connected accounts, chats, latest message preview, unread indicators, and connection status.
2. WHEN a user opens a chat THEN the system SHALL display chronological message history with sender identity, timestamps, delivery state, message type, and media references.
3. WHEN a user searches by keyword, chat name, participant, or time range THEN the system SHALL return matching conversations or messages scoped to the accounts the user can access.
4. IF message history is large THEN the system SHALL paginate or incrementally load results without blocking the interface.
5. WHEN a first-time operator enters the conversation workspace THEN the system SHALL present clear labels, empty-state guidance, and obvious primary actions for reviewing chats and opening message history.

### Requirement 4

**User Story:** As an operator, including junior staff handling routine support work, I want to export WhatsApp conversations and related assets, so that I can produce offline records for analysis, compliance, handoff, or backup without misconfiguring export scope.

#### Acceptance Criteria

1. WHEN an operator creates an export job THEN the system SHALL allow selection of account, chat scope, time range, included media behavior, and output format.
2. WHEN an export job is submitted THEN the system SHALL process it asynchronously and expose job status, progress, and failure reasons.
3. WHEN an export job completes successfully THEN the system SHALL provide a downloadable artifact in at least `JSON`, `Markdown`, and `HTML` formats.
4. IF media inclusion is enabled and the referenced asset is available THEN the system SHALL include media links or packaged files according to the chosen export format.
5. WHEN an export artifact expires or is manually deleted THEN the system SHALL preserve the export audit record while revoking access to the artifact itself.
6. WHEN an operator configures an export job THEN the system SHALL explain the effect of scope, time range, format, and media options in plain language before submission.

### Requirement 5

**User Story:** As a platform operator, I want to configure AI agents and reply rules, so that the system can generate suggested or automatic WhatsApp replies within defined guardrails while making risky automation settings understandable to inexperienced staff.

#### Acceptance Criteria

1. WHEN an operator configures an agent THEN the system SHALL allow definition of trigger scope, prompt policy, knowledge sources, reply mode, and safety limits.
2. WHEN a new inbound message matches an enabled rule THEN the system SHALL build reply context from recent chat history and invoke the configured agent workflow.
3. WHEN an agent is configured for suggestion mode THEN the system SHALL store the generated draft and require an operator action before sending.
4. WHEN an agent is configured for auto-send mode THEN the system SHALL send the generated reply only if all configured safety checks pass.
5. IF a rule cooldown, message quota, blacklist, or sensitive-topic restriction is violated THEN the system SHALL block automatic sending and record the reason.
6. WHEN an operator enables or edits auto-send behavior THEN the system SHALL display prominent warnings and explain the operational impact before the change is saved.

### Requirement 6

**User Story:** As a compliance-minded operator, I want all sensitive actions to be visible and auditable, so that account usage, exports, and agent behavior can be reviewed and controlled.

#### Acceptance Criteria

1. WHEN a user connects or disconnects an account, changes an agent rule, sends an agent-assisted reply, or creates an export job THEN the system SHALL create an audit log entry with actor, action, target, timestamp, and outcome.
2. WHEN an operator reviews an agent run THEN the system SHALL expose the triggering message, relevant context, generated output, send decision, and any blocked-safety reason.
3. IF a user lacks permission to access an account or export artifact THEN the system SHALL deny access and record the denied attempt.
4. WHEN system health degrades due to session failures, ingestion backlog, or export processing errors THEN the system SHALL surface actionable status information to operators.

## Non-Functional Requirements

### Code Architecture and Modularity
- **Single Responsibility Principle**: Session management, message ingestion, export generation, agent orchestration, and UI concerns must be separated into focused modules or services.
- **Modular Design**: Protocol adapters, persistence repositories, export renderers, and agent providers must be replaceable without rewriting unrelated layers.
- **Dependency Management**: `whatsmeow` integration must be isolated behind internal interfaces so transport-specific logic does not leak into application or UI modules.
- **Clear Interfaces**: Backend APIs and internal service boundaries must use explicit request and response contracts with typed validation.

### Performance
- The platform SHALL ingest and persist normal inbound and outbound message traffic for an active account with near-real-time visibility in the UI.
- Chat list and chat detail views SHALL support pagination or incremental loading to handle large histories efficiently.
- Export jobs SHALL run asynchronously so large exports do not block login, browsing, or message ingestion workflows.

### Security
- Session credentials, device keys, and other authentication material SHALL be stored securely and must never be exposed in the UI or logs.
- The platform SHALL enforce authenticated access to administrative APIs and restrict account, export, and agent operations by role or explicit permission scope.
- Agent auto-send flows SHALL include configurable safeguards such as cooldowns, blacklists, allowlists, and sensitive-topic blocking.

### Reliability
- The system SHALL survive process restarts without losing previously archived messages, account state, export history, or agent audit records.
- Message ingestion SHALL be idempotent so protocol retries or duplicate deliveries do not create duplicate records.
- The platform SHALL expose connection and processing status so operators can detect stuck sessions, failed exports, or disabled automations.

### Usability
- The primary operator workflows of connecting an account, reviewing chats, exporting records, and managing agent rules SHALL be achievable from a single administrative web interface.
- Export configuration and agent configuration screens SHALL make the impact of each option clear before execution.
- Audit and failure states SHALL present human-readable reasons rather than raw protocol or stack-trace output whenever possible.
- The interface SHALL be usable by newly onboarded employees with minimal training by emphasizing guided actions, plain-language labels, safe defaults, and visible status feedback.
- Risky actions such as logout, export deletion, and auto-send activation SHALL be visually differentiated from routine actions and require explicit confirmation.
