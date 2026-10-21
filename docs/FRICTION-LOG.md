# Friction log: building an Alexa+ MCP add-on for Plot Speaks

Build, Ship, Shape: Amazon Developer Hackathon 2026, Alexa+ track. Volocent Labs LLC, October 2026.
Plot Speaks is a remote MCP server (https://plotspeaks.com/mcp, Streamable HTTP, spec 2025-11-25)
that was built to be connected to Alexa+ as a self-hosted MCP add-on. This log records what
happened when we tried.

## 1. Alexa AI CLI: AssumeRole refused (blocker)

- **Task:** install the `@alexa-ai/cli` to register the MCP server as an add-on.
- **Steps:** followed "Set Up Your Development Environment" exactly: Amazon developer account; AWS
  account; IAM user with the published inline policy (`sts:AssumeRole` on
  `arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead`); AWS CLI 2 on Ubuntu (WSL); profile
  `alexa-ai` with `role_arn` and `source_profile`; `aws sts get-caller-identity --profile alexa-ai`.
- **Expected:** the role is assumed and `aws codeartifact login` makes `npm install -g @alexa-ai/cli` work.
- **Actual:** `get-caller-identity` on the IAM user works; through the role it returns AccessDenied.
  The role's trust policy lists invited AWS accounts only. The setup page does not say so; the only
  hint is "available to select partners" on the Alexa+ overview page.
- **Severity:** blocker. The server could not be connected to Alexa+ at all.
- **Workaround:** none. Developer support case 75213628: Amazon confirmed the preview is "rolled out
  to partners in phases", AccessDenied is expected, interest recorded.
- **Suggestion:** state on the setup page that the role is allow-listed and link the request form;
  or allow hackathon entrants in the Alexa+ track to assume it for the window.

## 2. CLI is macOS/Ubuntu only, distributed through AWS CodeArtifact (high)

- **Task:** install the CLI on a Windows development PC.
- **Steps:** WSL Ubuntu, AWS CLI, IAM user, assumed role, CodeArtifact login, then `npm install`.
- **Expected:** `npm install -g @alexa-ai/cli` from npmjs.com, on any OS.
- **Actual:** five prerequisites (and an AWS account) before the first command; no Windows build.
- **Severity:** high.
- **Workaround:** WSL.
- **Suggestion:** publish the CLI on npmjs.com, or ship a Windows build.

## 3. Two authentication documents, one gap (medium)

- **Task:** work out how an MCP server with OAuth 2.1 gets its client id and secret into Alexa.
- **Steps:** read the MCP authentication page (Tier 1 `client_credentials`, Tier 2 authorization code,
  "dynamic client registration is not supported") and the add-on manifest reference.
- **Expected:** a field or a console screen where the client id and secret are entered.
- **Actual:** `addon.json` has no such field and the console is unreachable without the CLI.
- **Severity:** medium.
- **Workaround:** none found; we implemented the server side (PKCE, RFC 9728 metadata) blind.
- **Suggestion:** one page from "my server has OAuth" to "Alexa calls it", with the exact field names.

## 4. `WWW-Authenticate` on 401 is "not supported" (medium)

- **Task:** reuse the same 401 discovery flow that Claude and Gemini use (MCP spec, RFC 9728).
- **Expected:** a 401 with `WWW-Authenticate: Bearer resource_metadata="..."` is accepted.
- **Actual:** the docs say the header is not supported; the wanted 401 shape is not documented.
- **Severity:** medium.
- **Workaround:** a separate host for Alexa is planned.
- **Suggestion:** accept the header, or document the exact 401 body Alexa expects.

## 5. 500 ms round-trip requirement with no measurement guidance (low)

- **Task:** meet the stated latency ceiling for tool calls.
- **Expected:** guidance on how it is measured and what happens on a slow call.
- **Actual:** a trivia challenge (three model calls) or a live roster fetch can exceed 500 ms; no
  pattern is documented for "acknowledge now, finish later".
- **Severity:** low.
- **Workaround:** caching (rosters 6 h) and smaller judge prompts.
- **Suggestion:** document a per-tool timeout hint, or a deferred-result pattern.

## 6. Track says "self-hosted MCP server"; entrants cannot connect one (medium)

- **Task:** enter the Alexa+ track with a self-hosted MCP server.
- **Expected:** a path, during the hackathon window, from a running server to Alexa+.
- **Actual:** the only path is the invitation-only toolkit (item 1). The "simulated experience"
  allowance helps, but the headline promise and the reachable path do not match.
- **Severity:** medium.
- **Suggestion:** a hackathon-window allow-list, or a hosted simulator that takes an MCP URL.
