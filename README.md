# BAND.us MCP Server - Community Integration

Community MCP server for BAND.us on Cloudflare Workers. Exposes documented
BAND Open API operations as authenticated tools for Microsoft Copilot Studio
and other Streamable HTTP MCP clients.

**This is not an official BAND, NAVER, Microsoft, or Cloudflare product.**
There is no affiliation, endorsement, or permission to use official branding.

## Status and architecture

The initial implementation includes eight tools, strict runtime schemas, offline
Workers-native tests, and a manually gated GitHub deployment workflow.
Live BAND operations and a tenant's Copilot Studio connection require operator
configuration; they have not been exercised with production credentials.

```text
Microsoft 365 Copilot (after publishing your agent)
  -> Microsoft Copilot Studio agent
  -> HTTPS /mcp (Streamable HTTP)
  -> Cloudflare Worker
  -> BAND Open API
  -> BAND.us
```

The Worker is stateless and supports the current SDK protocol and 2025-era clients.
Legacy session `GET` and `DELETE` requests return `405`; tools use MCP POST requests.
No KV or D1 database is needed.

Authentication has two separate boundaries:

- **Client -> Worker:** a private MCP bearer token.
- **Worker -> BAND:** an OAuth access token for one operator-connected BAND account.

All clients holding the MCP token share that account's BAND identity and read
access. This is not a per-user BAND OAuth service or a multi-tenant permission
system. Do not share its MCP token with untrusted users.

## Prerequisites

- Node.js 24 or newer and npm.
- A Cloudflare account with Workers access for deployment.
- A registered application in [BAND Developers](https://developers.band.us/develop/myapps/list).
- A BAND account connected to that application and authorized for the needed APIs.
- For Copilot Studio, a tenant with the MCP tools feature available and permission
  to create the agent and connection.

## BAND developer setup

1. Register your service in BAND Developers.
2. Use **Connect BAND account** in My Apps to obtain an operator access token.
   This is the [documented single-account setup](https://developers.band.us/develop/guide/api/get_authorization_code_from_user).
3. Grant only the capabilities you need. The tool set uses the documented
   `READ_BAND_AND_USERS_LIST`, `READ_POST`, `READ_COMMENT`, `READ_BAND_PERMISSION`,
   `WRITE_POST`, `DELETE_POST`, and `CREATE_COMMENT` capabilities; owned-post
   deletion additionally needs `READ_MY_PROFILE` to verify the author.
4. Keep the access token private. It is never an MCP tool argument.

An access token may expire or be revoked. Reconnect the account and replace the
binding when BAND returns `10401`. No interactive OAuth callback or automatic
refresh-token grant is implemented; do not assume an undocumented refresh API.

## Local development

From the repository root, in PowerShell:

```powershell
npm ci
Copy-Item -LiteralPath .dev.vars.example -Destination .dev.vars
```

Edit `.dev.vars` locally with a private BAND token and a separately generated MCP
token. The placeholders are intentionally rejected. `.dev.vars` is git-ignored;
never paste real credentials into issues, chat, examples, or logs.

Generate a random MCP token locally, then transfer it directly to your secret
configuration:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
npm run check
npm run dev
```

Wrangler reports the local address, normally `http://localhost:8787`.
The MCP endpoint is `/mcp`. Send `Authorization: Bearer <your-MCP-token>`.
Never use the BAND access token as the MCP credential.

`GET /health` is a credential-free **liveness** check, not a check of BAND
connectivity, permissions, or deployment readiness.

## Tools and upstream contracts

| Tool | Required arguments | Effect | Documented upstream API |
| --- | --- | --- | --- |
| `band_list_bands` | None | Read joined Bands | [GET `/v2.1/bands`](https://developers.band.us/develop/guide/api/get_bands) |
| `band_list_posts` | `band_key` | Read one page of posts | [GET `/v2/band/posts`](https://developers.band.us/develop/guide/api/get_posts) |
| `band_get_post` | `band_key`, `post_key` | Read a specific post | [GET `/v2.1/band/post`](https://developers.band.us/develop/guide/api/get_post) |
| `band_create_post` | `band_key`, `content`, `confirm: true` | Publish a text post | [POST `/v2.2/band/post/create`](https://developers.band.us/develop/guide/api/write_post) |
| `band_delete_post` | `band_key`, `post_key`, `confirm: true` | Permanently delete an owned post | [POST `/v2/band/post/remove`](https://developers.band.us/develop/guide/api/remove_post) |
| `band_list_comments` | `band_key`, `post_key` | Read one page of comments | [GET `/v2/band/post/comments`](https://developers.band.us/develop/guide/api/get_comments) |
| `band_create_comment` | `band_key`, `post_key`, `body`, `confirm: true` | Add a text comment | [POST `/v2/band/post/comment/create`](https://developers.band.us/develop/guide/api/write_comment) |
| `band_check_permissions` | `band_key` | Check write/delete permissions | [GET `/v2/band/permissions`](https://developers.band.us/develop/guide/api/get_post_permission) |

Optional arguments:

- Post listing: `locale` defaults to `en_US`; `cursor` accepts the previous result's
  `next_cursor`.
- Comment listing: `sort` defaults to `+created_at`; `cursor` works the same way.
- Post creation: `do_push` defaults to `false`; enabling it may notify members.
  Comment creation can also notify members.
- Permission checks: `permissions` defaults to `posting`, `commenting`, and
  `contents_deletion`.

All inputs are strict: unknown fields and invalid values are rejected. Keys are
opaque strings. Creation accepts nonblank text up to 10,000 characters as a
server-side safety bound; BAND may impose a smaller limit.

Results expose selected, validated fields, not raw provider JSON. Success uses
`{ "ok": true, "data": ... }` in both `structuredContent` and JSON text content.
Failure uses `isError: true` with:

```json
{
  "ok": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "The BAND account does not have the required permission.",
    "category": "permission",
    "retryable": false,
    "correlation_id": "synthetic-correlation-id"
  }
}
```

Pagination returns only an opaque `after` value and an optional bounded `limit`.
It never returns BAND's embedded pagination access token, arbitrary URLs, or
replacement resource identifiers. A final page has `next_cursor: null`.

BAND's permissions table uses `permissions` while its example uses `permission`.
Both documented shapes are validated and normalized; ambiguous or missing
permission data is rejected.

## Configuration and write safety

| Binding | Purpose |
| --- | --- |
| `MCP_AUTH_TOKEN` | Private bearer credential for MCP clients. |
| `BAND_ACCESS_TOKEN` | Required private token for the connected BAND account. |
| `BAND_ENABLE_WRITES` | Boolean string; defaults to `"false"`. |
| `BAND_WRITE_BAND_KEYS` | Private write-target allowlist. |
| `MCP_ALLOWED_ORIGINS` | Optional additional allowed origins. |

MCP credentials require at least 32 token characters; prefer 32 random bytes.
Write enablement accepts exactly `"true"` or `"false"`. The write allowlist is
comma-separated; missing or empty denies all writes. Additional origins must be
exact HTTP(S) origins, comma-separated, without wildcards. The request's own
origin is also allowed.

Writes require **all** of:

1. A valid MCP credential.
2. `BAND_ENABLE_WRITES` set to `"true"` through a reviewed configuration change.
3. The exact target in `BAND_WRITE_BAND_KEYS`.
4. `confirm: true` in the tool arguments.
5. A successful BAND permission check before the mutation.

Deletion additionally verifies that the post belongs to the configured BAND
account using the documented profile API. Deleting another author's post is
intentionally not supported, even if a broad BAND permission is returned.

`confirm: true` expresses intent; it is not proof of human consent. Configure
Copilot Studio or your MCP client's confirmation/approval controls for writes.

Requests are capped at 128 KiB; BAND responses at 1 MiB. Requests time out after
10 seconds. Read requests retry at most once, with at most one second of delay;
longer `Retry-After` values prevent an automatic retry. Mutations are never
automatically retried. After an ambiguous write failure, inspect BAND before
retrying manually. Redirects are not followed.

## Cloudflare and GitHub deployment

1. Review `wrangler.jsonc` and configure your intended Worker name/account.
2. Create a GitHub environment named **production**, require reviewers, and
   restrict its deployment branches to **main**.
3. Add the environment secret `CLOUDFLARE_API_TOKEN` with only the Cloudflare
   deployment permissions needed for this account. Add `CLOUDFLARE_ACCOUNT_ID`
   as an environment **variable**, not a secret.
4. Publish the reviewed source to your approved `main` branch.
5. Run **Validate and deploy BAND MCP** from `main` with `deploy` enabled.
   Pushes, pull requests, and dispatches with `deploy: false` only validate.
   A deployment request from another branch fails validation.
6. Configure Worker secrets privately using the Cloudflare dashboard or Wrangler:

   ```powershell
   npx wrangler login
   npx wrangler secret put MCP_AUTH_TOKEN
   npx wrangler secret put BAND_ACCESS_TOKEN
   ```

   Until `MCP_AUTH_TOKEN` is configured, `/mcp` fails closed with `503`.
   Store approved write Band IDs with `npx wrangler secret put BAND_WRITE_BAND_KEYS`
   only when intentionally enabling writes. Never put these values in workflow
   files or public configuration.

The workflow cannot create your review policy, credentials, or BAND account
connection. Its `production` environment must be protected before use.
No actual Cloudflare deployment is performed by `npm run build`; it is a dry run.
`npm run deploy` is a real publication command and must only be used by an
authorized operator for reviewed source.

## Connect Microsoft Copilot Studio

Follow Microsoft's [MCP onboarding documentation](https://learn.microsoft.com/microsoft-copilot-studio/mcp-add-existing-server-to-agent):

1. Add a Model Context Protocol tool to the agent.
2. Set the server URL to `https://<your-worker-host>/mcp`.
3. Select **API key**, type **Header**, name **Authorization**.
4. Create the connection with the value `Bearer <your-MCP-token>`.
5. Add the tools and test read-only operations first.
6. Require explicit approval for writes before enabling them.

Do not select OAuth 2.0 for this initial server: it does not expose an MCP OAuth
authorization server. Never put `BAND_ACCESS_TOKEN` in the Studio connection.
Connecting Studio does not automatically publish the agent to Microsoft 365
Copilot; publish through your tenant's supported channel and approval process.

## Validation and repository layout

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run check` runs these in order. Tests execute in Cloudflare's Workers runtime,
use synthetic fixtures, and block real network requests. They verify every tool's
valid/invalid requests, authentication and permission failures, provider errors,
unexpected responses, MCP schemas, legacy/current clients, and safety boundaries.
Vitest 4 is pinned for Windows Workers-test compatibility.

Generated runtime types live under `.wrangler/types`; bundles under `dist`.
Both directories are git-ignored. Use the included lockfile for reproducible
`npm ci`.

- [BAND API layer](src/band): centralized HTTP and typed operations.
- [MCP layer](src/mcp): server, registration, and shared structured results.
- [Tool definitions](src/tools): schemas, descriptions, and annotations.
- [Authentication](src/auth/oauth.ts): pre-provisioned bearer verification.
- [Credential source](src/storage/index.ts): Cloudflare secret bindings, no database.
- [Tests](tests) and [CI/deploy workflow](.github/workflows/deploy.yml).
- [Security policy](SECURITY.md).

## Troubleshooting and boundaries

- **HTTP 401:** the MCP bearer token is missing or incorrect.
- **HTTP 503:** required MCP configuration is missing, weak, or invalid.
- **HTTP 403:** a browser Origin is not approved.
- **Tool `UNAUTHORIZED`:** reconnect the BAND account and replace its token.
- **Tool `PERMISSION_DENIED`:** check write enablement, approved Band IDs,
  BAND permissions, and ownership when deleting.
- **Tool `INVALID_BAND_RESPONSE`:** use the correlation ID to report a response
  incompatibility without posting credentials or private BAND content.
- **Rate limits:** wait as directed by BAND; do not loop or bypass quotas.

There is no calendar API, Microsoft Graph integration, scraping, file upload,
interactive per-user OAuth, or persistent token database. Future Microsoft 365
calendar orchestration must remain outside `src/band`, and must not be described
as BAND calendar synchronization without a documented endpoint.

Licensed under [Apache-2.0](LICENSE).
