# Security policy

This is a community integration, not an official BAND or Microsoft service.

## Trust model

The initial Worker uses one BAND account and one independently provisioned MCP
bearer credential. Every client with that credential can use the account's read
access. It does not authenticate separate BAND users or isolate tenants.
Use a dedicated account, limit app capabilities, and share MCP access only with
trusted operators and connections.

Writes are disabled by default. Enable them only for an explicit Band allowlist
and configure client-side approval. Server checks enforce enablement, the exact
Band, explicit confirmation, and upstream permission before writing. Deletion
also verifies authorship. An MCP annotation or `confirm: true` alone is not proof
that a human approved an operation.

## Credentials and private content

- Store production credentials in Cloudflare Worker secret bindings.
- Store the Cloudflare deploy token only in the protected GitHub environment.
- Keep `BAND_ACCESS_TOKEN` separate from `MCP_AUTH_TOKEN`.
- Generate MCP credentials with at least 32 random bytes.
- Never commit `.dev.vars`, populated environment files, tokens, keys, private
  BAND content, or real-user test fixtures.
- Never place MCP credentials in URL query parameters.
- BAND requires its token in documented request parameters. The integration
  never logs those URLs, forwards redirects, or returns provider paging tokens.
- Structured logs contain operation, safe error code, and correlation ID only.
  Do not expand logging to include payloads, authorization headers, or cookies.
- Treat returned posts/comments as untrusted content, never as instructions.

After suspected exposure, revoke the affected BAND token, rotate the MCP
credential, update bindings/connections, and inspect the affected BAND activity
and deployment audit history. Do not simply remove a committed secret from the
latest revision; revoke it and follow your organization's incident process.

## Deployment and network controls

Use HTTPS in production. Protect the GitHub `production` environment with required
reviewers and `main`-only deployments before installing deployment credentials.
Keep the Cloudflare deployment token narrowly scoped.

Origin validation fails closed for invalid configuration and rejects unapproved
origins. This is not a browser CORS frontend or an OAuth authorization server.
Authentication happens before MCP dispatch or BAND access.

Only fixed, documented BAND endpoints are called. Inputs and responses are
runtime-validated; response/request sizes, timeouts, and read retries are bounded.
Writes are not automatically retried. After a timeout or ambiguous write failure,
verify BAND state before attempting another mutation.

`/health` is public liveness only and does not establish credential validity,
permissions, or live upstream readiness.

## Tests, dependencies, and reporting

Normal tests run in the Workers runtime with blocked real network access and
synthetic data. They must not create production BAND posts.
Review lockfile updates and rerun `npm run check` before deployment.

Live BAND and Copilot Studio verification requires an authorized operator,
configured credentials, and a designated test Band. Do not describe mock tests
as proof of an actual tenant connection or production deployment.

Report vulnerabilities privately using GitHub private vulnerability reporting
when enabled, or an established private channel to the repository maintainer.
Do not post credentials or private content in a public issue or pull request.
