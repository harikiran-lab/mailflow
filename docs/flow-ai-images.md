# Build and deploy the fork's Docker images

## Build from GitHub

Open [Actions → Build Flow AI images](https://github.com/harikiran-lab/mailflow/actions/workflows/flow-ai-images.yml) and click **Run workflow**. Leave **Use workflow from** on `main`, then choose:

- **source_ref**: the branch, tag, or commit containing the application to build; default `feat/flow-ai`.
- **image_tag**: a lowercase container tag; default `flow-ai`. Use a separate tag such as `staging` for another build.
- **platforms**: both `linux/amd64,linux/arm64` by default, or one architecture for a faster build.

Click the green **Run workflow** button. Both frontend and backend jobs must succeed. Each job's summary shows the exact source commit, image tags, image digest, and deployment commands. The workflow uses the repository's automatic `GITHUB_TOKEN`; no personal token or registry password needs to be added.

Default published images:

```text
ghcr.io/harikiran-lab/mailflow-backend:flow-ai
ghcr.io/harikiran-lab/mailflow-frontend:flow-ai
```

Each build also publishes a commit tag, for example `flow-ai-a8de79d`. The selected source commit is used for the image label and application build SHA even when the workflow itself runs from `main`. Pushes to `feat/flow-ai` automatically build the default tag as well.

The workflow is installed on `main` so GitHub displays its manual controls; the application source can remain on the feature branch. See [GitHub's manual workflow documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## Update your server

The workflow publishes images. Run the following on the machine hosting MailFlow to update the running containers.

Use the fork's `docker-compose.ghcr.yml` plus `docker-compose.flow-ai.yml` in your existing MailFlow deployment directory, alongside your configured `.env`. For an existing installation, retain its database, Redis volumes, and encryption/session secrets. Back up the installation before upgrading because the backend runs database migrations at startup.

```sh
# In the existing MailFlow deployment directory:
export MAILFLOW_FLOW_AI_TAG=flow-ai
docker compose -f docker-compose.ghcr.yml -f docker-compose.flow-ai.yml pull
docker compose -f docker-compose.ghcr.yml -f docker-compose.flow-ai.yml up -d
docker compose -f docker-compose.ghcr.yml -f docker-compose.flow-ai.yml ps
```

Set `MAILFLOW_FLOW_AI_TAG` to your chosen custom tag or a commit tag to pin a build. It can also be stored in `.env`. On PowerShell, use `$env:MAILFLOW_FLOW_AI_TAG='flow-ai'` in place of `export`. The override uses `harikiran-lab` by default; `MAILFLOW_IMAGE_OWNER` can change the registry namespace when reusing this workflow in another fork.

If your deployment already uses extra compose overrides (such as the HTTPS/Caddy configuration), retain them in the command and put the Flow AI image override last. If GHCR reports unauthorized, ensure the packages are public or log in with a GitHub credential allowed to read them; package visibility is independent of repository visibility.

After startup, enable Flow AI, AI Inbox, API/MCP, and webhooks as needed under **Settings → Integrations → Apps**, then activate Flow AI in Plugins and opt in the desired inbox accounts. See [Flow AI configuration and API details](https://github.com/harikiran-lab/mailflow/blob/feat/flow-ai/docs/flow-ai.md) on the feature branch.

This workflow does not connect to your host or restart containers remotely. It requires no SSH credentials and prints the exact commands for you to run.
