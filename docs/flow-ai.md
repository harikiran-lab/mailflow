# Flow AI and developer integrations

Flow AI adds a floating mailbox assistant and an opt-in AI Inbox. Questions use scoped mailbox search and bounded email excerpts, with links back to source messages. Organization and plain-text reply drafts appear as expiring previews; applying one requires a separate user click. Flow cannot send mail, delete messages, unsubscribe, or create autonomous rules. Email content and model tool arguments remain untrusted inputs checked on the server.

## Enable

1. Configure MailFlow's existing AI provider and user AI access. OpenAI-compatible Chat Completions providers must support streamed function/tool calls; ChatGPT/Codex provider support uses its native tool format.
2. Under **Settings → Integrations → Apps**, an administrator enables Flow AI and/or AI Inbox. Developer API, MCP, and webhooks have separate administrator switches and default to off.
3. Activate **Flow AI** under Plugins. The floating sparkle opens the assistant; **AI Inbox** appears in the sidebar. Account scope applies to the entire conversation; changing scope starts a fresh conversation.
4. Enable each desired inbox account in AI Inbox. The initial analysis covers up to 500 conversations from the last 30 days. Later ingested mail queues incremental work. Refresh requests are bounded to 10 per hour; chat to 30 per hour per user. Suggestions include an exact evidence quote, source link, progress, and freshness. Dismissing or snoozing a suggestion only changes the briefing.
5. To capture notes, tasks, or reminders, activate and connect the existing NoteTrace integration. Flow opens its editable reviewer, retaining the prepared extraction. Saving creates NoteTrace items and local receipts; it does not synchronize remote completion or edit remote items.

Background analysis runs through a durable database queue outside IMAP synchronization. It checkpoints progress and retries failures. Suggestions are based on partial excerpts and require review. Drafts do not send mail. Chat history is retained for 90 days and can be deleted in the assistant.

## Optional embeddings

Administrators can configure a separate OpenAI-compatible `/embeddings` base URL, API key, and model in Apps. The key is encrypted with MailFlow's encryption key. Embeddings are optional: normalized vectors are stored in regular PostgreSQL arrays and rerank existing search candidates. This is not a whole-mailbox vector index. Keyword/full-text search remains available if the embedding provider fails. No pgvector extension, PostgreSQL image change, or extra database is required. Existing AI connection network rules apply to the embedding provider.

## API tokens and MCP

With the relevant administrator switch enabled, each user creates their own named token in Apps, restricted to explicit accounts and scopes. Tokens expire (30 days by default, maximum 365), are shown once, and are stored only as SHA-256 hashes. Revocation takes effect on subsequent requests and proposal confirmation.

Scopes: `mail:read`, `mail:organize`, `drafts:write`, `notetrace:capture`. Keep the smallest scope set needed. Tokens cannot administer the server, issue tokens, or manage webhook subscriptions.

REST base: `/api/v1`. Authenticate with `Authorization: Bearer <token>`; cookies alone are rejected. Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/accounts` | Allowed accounts |
| GET | `/folders?account_id=…` | Owned folders |
| GET | `/messages?q=…&account_id=…` | Scoped search, existing search operators |
| GET | `/messages/:id?conversation=true` | Bounded message/conversation content |
| POST | `/proposals` | Preview an exact operation |
| GET | `/proposals/:id` | Preview and receipts |
| POST | `/proposals/:id/confirm` | Apply with JSON `{"confirm":true}` |
| POST | `/tools/:name` | Shared validated tool catalog |

For example, preview marking an email read with `{"action":"read","message_ids":["<email UUID>"],"read":true}`. Present the returned messages and arguments to the user, then confirm the returned proposal ID in a separate request. Previews expire after 15 minutes and are tied to the creating token. Changed message locations/UIDVALIDITY require a fresh preview. Completed confirmations return saved receipts; uncertain interrupted executions are not automatically replayed. External clients are responsible for obtaining authorization: two API calls alone do not prove human review.

MCP endpoint: `https://your-mailflow.example/api/mcp`, stateless Streamable HTTP, using the same bearer token. Supports legacy initialization and modern stateless protocol requests through the MCP SDK. Tools include `list_accounts`, `list_folders`, `search_mail`, `read_mail`, `prepare_action`, `get_proposal`, `confirm_proposal`, and `prepare_capture`, filtered by token scopes. Flow's own model tool list excludes confirmation. Sending and deleting are never exposed.

Browser origins must match APP_URL/FRONTEND_URL or an explicit comma-separated `MCP_ALLOWED_ORIGINS` entry. Non-browser clients may omit Origin. Rate limits apply per IP and token.

## Webhooks

Create subscriptions in Apps with an HTTPS URL, allowed accounts, and chosen events: `mail.received`, `mail.changed`, `draft.changed`, `flow.inbox.updated`, `notetrace.captured`. Payloads contain identifiers and metadata rather than message bodies. Test, inspect delivery history, retry, and delete subscriptions in Apps. The signing secret is shown once and stored encrypted.

Headers: `X-Mailflow-Event`, `X-Mailflow-Delivery`, `X-Mailflow-Timestamp`, `X-Mailflow-Signature`. Verify `v1=` followed by the hex HMAC-SHA256 of `timestamp + "." + exactRawRequestBody`, using the subscription secret. Compare signatures in constant time, reject old timestamps, and deduplicate event IDs. Return a 2xx response after accepting the event. Delivery uses a durable outbox, bounded retries, and a 10-second request timeout; receivers must tolerate duplicates. Delivery history is retained for 30 days.

Private webhook destinations require an exact origin in the comma-separated `WEBHOOK_ALLOWED_PRIVATE_ORIGINS` administrator environment variable (including scheme and port). Redirects are not followed and DNS addresses are validated and pinned for delivery. Existing NoteTrace private origin settings remain separate.

## Deployment

Migration `0069_flow_integrations.sql` runs with the existing migration runner. It adds tokens, proposals, jobs, optional embeddings, subscriptions, and deliveries. Back up before upgrading. Backups include integration configuration, tokens, and subscriptions; proposal/job/delivery execution state is intentionally excluded from restore so it cannot replay old operations. Preserve ENCRYPTION_KEY to retain usable encrypted credentials.

The fork's **Build Flow AI images** workflow publishes amd64 and arm64 images on pushes to `feat/flow-ai`: `ghcr.io/harikiran-lab/mailflow-backend:flow-ai` and `ghcr.io/harikiran-lab/mailflow-frontend:flow-ai`, plus immutable commit tags. Use `docker-compose.flow-ai.yml` together with `docker-compose.ghcr.yml` to pull the fork images. PostgreSQL stays `postgres:16-alpine`. Configure and enable the features after the containers start; all new administrator switches default to off.
