# NoteTrace capture

The optional NoteTrace plugin saves reviewed emails and AI results to your own NoteTrace account. Email notes and summaries are Markdown. Each task becomes a one-item native NoteTrace checklist, visible in Tasks, with its own due date and reminder.

Deploy the matching [NoteTrace capture API](https://github.com/harikiran-lab/notetrace/pull/13) before enabling this plugin.

## Connect

1. Deploy the matching NoteTrace capture feature first. Set `CAPTURE_ENABLED=1` and restart NoteTrace. Account mode is required; neither NoteTrace AI nor MCP is needed.
2. In NoteTrace, sign in and open **Settings → API Tokens**. Create a `capture:write` token and copy it. Ordinary users can create only capture tokens; admin MCP permissions remain separate.
3. In MailFlow, enable **NoteTrace** under **Settings → Plugins**. Open **Integrations → Apps**, enter the NoteTrace base URL (including any subpath), token, and IANA time zone, then connect.
4. For a private server, the MailFlow administrator must set `NOTETRACE_ALLOWED_PRIVATE_ORIGINS` to the exact origin, for example `http://notetrace:3004`, and restart the backend. Compose forwards this setting. Public servers require HTTPS. Redirects are rejected, so enter the final base URL.

Use an address reachable by the MailFlow backend. If NoteTrace is behind a separate proxy login, allow its `/api/capture` subtree to reach NoteTrace without that login; this subtree still requires its own capture token. The browser UI remains protected normally.

## Capture

Open the **NoteTrace** notebook dropdown in the message header (also available on expanded conversation messages). A small dot on its icon means the message has saved captures; open the menu to follow their links. Captures with the same destination appear once.

The review dialog starts with notes and tasks collapsed. Select items with their checkboxes, then click an item's title to edit it; opening another item closes the previous editor while preserving edits. The **Selected email / Entire conversation** toggle changes the source for a fresh capture. Existing AI results keep their original source scope. Due dates and reminders remain visible in collapsed task rows, and validation opens an item that needs attention.

- **Save email to NoteTrace** opens an editable Markdown note. HTML formatting is converted; scripts, hidden content, remote images, and attachments are excluded.
- **Create NoteTrace task** lets you edit a task, due date, and optional reminder without calling AI.
- **Prepare summary & tasks** uses MailFlow's configured AI and respects its existing per-user permissions. Review the Markdown summary, task selection, date evidence, time zones, and reminders before saving.
- Completed AI result boxes offer **Save result as note** and **Review as tasks**. Saving an existing summary does not regenerate it. Converting free-form action output to dated native tasks uses a structured AI request.
- The selected message is the default. Choose **Entire conversation** explicitly before preparing a fresh capture. Existing AI results remain tied to the message that generated them.

Only clearly assigned personal actions start checked. Other or uncertain assignees remain visible and unchecked. Clear deadlines suggest a reminder one hour before an exact time, or 9 AM on a date-only deadline. Urgency without a date requires choosing a time or explicitly choosing no reminder. Relative dates are interpreted against the source email's date. Always review inferred dates. Ambiguous daylight-saving times require an unambiguous time or an explicit UTC value.

Every saved card has a source-email link. Tasks use a separate card so reminders are independent. Completion cancels reminder delivery after each device receives the change through normal sync; an offline device cannot learn changes made elsewhere until it reconnects. Server push or Android notifications are needed for delivery while the browser is closed.

Saves are transactional and safe to retry after a lost response. Previously saved captures are unchecked and link to their existing cards; explicitly select **Create another copy** to duplicate one. NoteTrace edits are never overwritten. Identical task wording within the same capture source is treated as the same task.

The first version copies text and links only. It does not automatically process incoming mail, copy attachments, create repeating tasks, archive mail, or synchronize completion back to MailFlow. New UI strings are provided in every supported MailFlow locale.

## API contract

MailFlow exposes authenticated, activation-gated `/api/notetrace/status`, `/connect`, `/disconnect`, `/preview`, `/captures`, and `/messages/:id` routes. Credentials are encrypted at rest and are never returned to the browser. Preview loads owned messages server-side; a snippet is not accepted as a complete body.

NoteTrace uses capture API v1. See the matching NoteTrace `docs/notetrace/capture.md` for request fields, token scopes, idempotency, and notification behavior. Connection checks capabilities before saving credentials.

## Validation

Run backend tests and both backend linters, frontend tests and lint, and the frontend production build. Use a current Node 22 patch release satisfying the locked frontend dependencies (22.22.2 or newer); older Node 22 releases can fail the React test harness. Rebuild both images from these branches to include the feature; upstream prebuilt images do not include it yet.
