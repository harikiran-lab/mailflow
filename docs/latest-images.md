# Latest Docker images from this fork

[Build latest images](https://github.com/harikiran-lab/mailflow/actions/workflows/latest-images.yml) publishes the frontend and backend from this fork's `main` branch after every push or merge into `main`. It can also be run manually: select **main** under **Use workflow from**, then **Run workflow**. Manual runs from other branches are skipped.

Both services build the exact triggering commit; there is no separate `source_ref` that can silently select an older feature branch. The application version comes from each service's package.json, and the images record the source commit in their labels and build metadata. Both linux/amd64 (including typical Unraid hosts) and linux/arm64 are built by default. A manual run can select a single architecture.

## Image names

| Service | Moving tag | Commit tag |
| --- | --- | --- |
| Backend | `ghcr.io/harikiran-lab/mailflow-backend:latest` | `ghcr.io/harikiran-lab/mailflow-backend:sha-<full-commit-sha>` |
| Frontend | `ghcr.io/harikiran-lab/mailflow-frontend:latest` | `ghcr.io/harikiran-lab/mailflow-frontend:sha-<full-commit-sha>` |

Wait for **both** jobs to succeed before updating. Their summaries show the application version, source SHA, and image digest. A failed build must not be treated as a complete frontend/backend release.

The workflow publishes images using the repository's automatic GITHUB_TOKEN; it does not require a personal token or SSH credentials. It does not synchronize upstream commits into this fork or restart your containers.

## Which custom features are included?

The latest images contain everything committed to `main`, including the NoteTrace integration. The additional Flow AI assistant and AI Inbox implementation currently live on `feat/flow-ai`; they are not automatically copied into `main` by this workflow.

The existing [Flow AI image workflow](flow-ai-images.md) and `:flow-ai` images are separate. To use the newer application together with those feature-branch changes, first integrate and validate them on the branch you intend to build. Selecting `:latest` does not carry over code that exists only on `feat/flow-ai`.

## Update an existing Compose deployment

Keep your existing deployment directory, configured .env, secrets, certificates, and volumes. Add the fork's `docker-compose.latest.yml` alongside `docker-compose.ghcr.yml`, then run:

~~~sh
docker compose -f docker-compose.ghcr.yml -f docker-compose.latest.yml pull
docker compose -f docker-compose.ghcr.yml -f docker-compose.latest.yml up -d
docker compose -f docker-compose.ghcr.yml -f docker-compose.latest.yml ps
~~~

Keep any other deployment overrides you already require and put the latest-image override last. Do not include the Flow AI override after it, because that would select `:flow-ai` again. The base GHCR compose file alone points to the upstream owner's images; the latest override selects this fork's images.

To pin a successful build, set `MAILFLOW_LATEST_TAG=sha-<full-commit-sha>` in .env for both images. This variable defaults to `latest`. `MAILFLOW_IMAGE_OWNER` defaults to `harikiran-lab`.

## Unraid

Set the backend and frontend repository fields to the corresponding `:latest` names above, then check for updates and update both containers. Preserve the existing volume mappings, ports, environment variables, and secrets. If GHCR requires authentication, ensure the packages are public or use a credential with permission to pull them.
