# Flow AI and developer integrations

For manual image builds and server update commands, see [Build and deploy Docker images](flow-ai-images.md).

Flow AI adds a floating mailbox assistant and an opt-in AI Inbox. Questions use scoped mailbox search and bounded email excerpts, with links back to source messages. Organization and plain-text reply drafts appear as expiring previews; applying one requires a separate user click. Flow cannot send mail, delete messages, unsubscribe, or create autonomous rules. Email content and model tool arguments remain untrusted inputs checked on the server.

## Enable

1. Configure MailFlow's existing AI provider and user AI access. OpenAI-compatible Chat Completions providers must support streamed function/tool calls; ChatGPT/Codex provider support uses its native tool format.
2. Under **Settings → AI Assistant**, an administrator enables Flow AI and/or AI Inbox. Developer API, MCP, and webhooks have separate administrator switches and default to off.
3. Activate **Flow AI** under Plugins. The floating sparkle opens the assistant; **AI Inbox** appears in the sidebar. Account scope applies to the entire conversation; changing scope starts a fresh conversation.
4. Enable each desired inbox account in AI Inbox. The initial analysis covers up to 500 conversations from the configured lookback (7 days by default, adjustable from 1 to 365 days). New Inbox and Sent messages queue incremental work. Sent replies refresh the affected conversations, including outgoing-only follow-ups. An hourly server-side job reassesses up to 500 Inbox/Sent conversations from the last 30 days with the current time, even when MailFlow is closed. This uses the configured AI provider; partial excerpts and conversation limits still apply. Sent edits/deletions are picked up by the hourly reassessment. Refresh requests are bounded to 10 per hour; chat to 30 per hour per user. Suggestions include an exact evidence quote, source link, progress, and freshness. Dismissing or snoozing a suggestion only changes the briefing.
5. To capture notes, tasks, or reminders, activate and connect the existing NoteTrace integration. Flow opens its editable reviewer, retaining the prepared extraction. Saving creates NoteTrace items and local receipts; it does not synchronize remote completion or edit remote items.

Background analysis runs through a durable database queue outside IMAP synchronization. The Refresh button requests a full bounded reassessment. Drafts are excluded from reply evidence so an unsent reply cannot satisfy a request. It checkpoints progress and retries failures. Suggestions are based on partial excerpts and require review. Drafts do not send mail. Chat history is retained for 90 days and can be deleted in the assistant.

## Optional embeddings

Administrators can configure a separate OpenAI-compatible `/embeddings` base URL, API key, and model under AI Assistant. The key is encrypted with MailFlow's encryption key. Embeddings are optional: normalized vectors are stored in regular PostgreSQL arrays and rerank existing search candidates. This is not a whole-mailbox vector index. Keyword/full-text search remains available if the embedding provider fails. No pgvector extension, PostgreSQL image change, or extra database is required. Existing AI connection network rules apply to the embedding provider.

## API tokens and MCP

With the relevant administrator switch enabled, each user creates their own named token under AI Assistant, restricted to explicit accounts and scopes. Tokens expire (30 days by default, maximum 365), are shown once, and are stored only as SHA-256 hashes. Revocation takes effect on subsequent requests and proposal confirmation.

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

Create subscriptions under AI Assistant with an HTTPS URL, allowed accounts, and chosen events: `mail.received`, `mail.changed`, `draft.changed`, `flow.inbox.updated`, `notetrace.captured`. Payloads contain identifiers and metadata rather than message bodies. Test, inspect delivery history, retry, and delete subscriptions under AI Assistant. The signing secret is shown once and stored encrypted.

Headers: `X-Mailflow-Event`, `X-Mailflow-Delivery`, `X-Mailflow-Timestamp`, `X-Mailflow-Signature`. Verify `v1=` followed by the hex HMAC-SHA256 of `timestamp + "." + exactRawRequestBody`, using the subscription secret. Compare signatures in constant time, reject old timestamps, and deduplicate event IDs. Return a 2xx response after accepting the event. Delivery uses a durable outbox, bounded retries, and a 10-second request timeout; receivers must tolerate duplicates. Delivery history is retained for 30 days.

Private webhook destinations require an exact origin in the comma-separated `WEBHOOK_ALLOWED_PRIVATE_ORIGINS` administrator environment variable (including scheme and port). Redirects are not followed and DNS addresses are validated and pinned for delivery. Existing NoteTrace private origin settings remain separate.

## Deployment

Migrations `0069_flow_integrations.sql` and `0070_flow_reassessment.sql` run with the existing migration runner. It adds tokens, proposals, jobs, optional embeddings, subscriptions, and deliveries. Back up before upgrading. Backups include integration configuration, tokens, and subscriptions; proposal/job/delivery execution state is intentionally excluded from restore so it cannot replay old operations. Preserve ENCRYPTION_KEY to retain usable encrypted credentials.

The fork's **Build Flow AI images** workflow publishes amd64 and arm64 images on pushes to `feat/flow-ai`: `ghcr.io/harikiran-lab/mailflow-backend:flow-ai` and `ghcr.io/harikiran-lab/mailflow-frontend:flow-ai`, plus immutable commit tags. Use `docker-compose.flow-ai.yml` together with `docker-compose.ghcr.yml` to pull the fork images. PostgreSQL stays `postgres:16-alpine`. Configure and enable the features after the containers start; all new administrator switches default to off.

## Inbox briefing and troubleshooting

AI Inbox greets the profile display name. The welcome card includes an At a glance briefing: up to ten saved suggestions, prioritizing actions and follow-ups, then newest topics. Check marks hide suggestions and fill the next available entry; they do not change email or complete NoteTrace tasks. Original source emails open independently of background analysis, including mail outside the loaded list or category.

AI Inbox remembers its account selection in browser storage per signed-in user, including unified accounts. Flow AI follows the currently viewed mailbox or AI Inbox selection. An unavailable account falls back to unified accounts. Flow AI has a maximize/restore control that preserves the draft and current conversation.

Background analysis processes one account job at a time per backend process. Model requests within a job are sequential. Failed requests pause that account with a scheduled retry; other queued accounts can continue. Completed conversations are retained, including successful single-conversation retries. Refresh clears old errors. Output exhaustion, empty answers, and invalid JSON get one retry per source with a larger allowance. Inbox requests reserve up to 16,384 output tokens initially and 32,768 on retry, including reasoning, with a four-minute request timeout. Reducing the number of sources does not reduce the reasoning allowance. Separate backend replicas and interactive chats can still share provider capacity.

Optional embeddings use bounded UTF-8 chunks (384 bytes by default), sequential batches of up to eight inputs, and normalized weighted pooling. Context-limit errors progressively reduce the chunk size to a minimum of 64 bytes; each embedding operation has a two-minute total deadline. At most 32 chunks per source are used. Both indexing and query embeddings use the same approach. The versioned index fingerprint prevents mixing older unchunked vectors. Embedding failures fall back to regular search and do not fail Inbox analysis.

Inbox analysis requests JSON Schema output where supported, then JSON-object mode, then prompt-only JSON if the provider explicitly rejects structured output. Unsupported format capabilities are cached for one hour. Other provider failures do not trigger a format downgrade. Low-temperature analysis (0.1) keeps the extraction focused. A completed HTTP request with `finish_reason: length` is an output-limit failure, including when its answer is empty or partial; reasoning-only output is never treated as final JSON. The retry panel exposes the exact last error under **Last error**. Earlier saved detections remain visible while another conversation or account waits for retry.

### Inbox focus and analysis controls

Open **AI Inbox → Inbox preferences** to change the lookback and exclude shopping, marketing, surveys, promotions, or social mail. These preferences are saved per user in PostgreSQL and filter all suggestion lists. Receipts, bills, charges, and invoices have separate financial classifications. The welcome card’s top ten always excludes bulk categories and prioritizes direct personal correspondence, financial items, and high-attention requests. Classification is model-generated and can be imperfect; evidence and source links remain available. Existing cached suggestions gain classifications during their next reassessment.

Use **Pause analysis** on the analysis status bar to pause enabled accounts in the selected scope. Pausing cancels in-flight model work, retains completed checkpoints, and survives restarts. New mail stays queued while paused. **Resume analysis** continues without clearing saved suggestions. The controls affect background Inbox analysis; interactive Flow AI chat remains available.

AI Inbox remembers its selected account per user on this browser. Flow AI defaults to the active mailbox, or to AI Inbox’s account selection while viewing AI Inbox. Its dropdown permits a temporary override; switching mailboxes resets the chat context. A selected email is included automatically only in the matching normal mailbox context. The animated bot reflects reading, composing an answer, completion, and errors, follows the active theme, and respects reduced-motion preferences.

### Background conversations, questions and drafts

Flow AI chat uses saved server-side runs. Closing the panel, changing mailboxes, or refreshing the browser does not cancel generation. The bot stays animated while a run is active, and completion produces an in-app notification and the user’s configured notification sound (including the None choice). Reopening Flow AI restores the current run. Stop explicitly cancels it. Each user has one active run; its account scope stays fixed while working. New conversations use the current mailbox. Outputs and partial results are stored privately in PostgreSQL for 90 days. A backend restart preserves partial output and reports interrupted running work as failed; queued runs are recovered. A retry is required for interrupted generation. Sound requires an open browser session and browser audio support.

The model can call ask_user to pause for clarification or a permission decision, with optional answer buttons and free-text input. It cannot confirm mail changes; proposal confirmation remains a separate user action. Replies support sanitized Markdown headings, emphasis, lists, emoji, tables and source links.

Generated draft proposals open Mailflow’s editable reply composer with the response inserted into the body, original threading and quote preserved. When there are other recipients, the draft card asks sender-only versus reply-all before opening. A draft generated while the assistant is closed remains available to open; existing unsaved editor content is guarded by the normal compose-switch protection. No email is sent automatically.

The welcome briefing includes compact NoteTrace task buttons. Suggested actions, follow-ups and topics start collapsed and form an accordion. Inbox preferences are at the bottom of the page. Email links can open in the current reading pane or an in-app popup; popup mode uses the reading pane on mobile, where detached message windows are unavailable. Account pickers use theme-aware menus with keyboard navigation.
