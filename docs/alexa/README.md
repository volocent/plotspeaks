# Alexa+ add-on: readiness and manifest

Plot Speaks is built to be connected to Alexa+ as a self-hosted MCP add-on. The server already meets
Alexa's published requirements (Streamable HTTP, MCP spec 2025-11-25, OAuth 2.1 with PKCE, RFC 9728
protected-resource metadata, HTTPS only, privacy and terms URLs, round trips well inside 500 ms on every
ordinary tool). `addon.json` here is the draft listing manifest: name, descriptions, example phrases,
media slots, publisher, the two sign-in tiers Alexa uses, and the tools that can run slow.

**Status (October 2026):** unvalidated. The `alexa-ai` CLI that validates and deploys a manifest is
distributed through an invitation-only preview ("rolled out to partners in phases", Amazon developer
support, case 75213628). Every documented setup step on our side is done; the final `AssumeRole` is
refused until Amazon adds our AWS account to the role's trust list. The friction log,
[`../FRICTION-LOG.md`](../FRICTION-LOG.md), records each step.

What happens when access arrives:

1. `alexa-ai configure`, then `alexa-ai new mcp --mcp-server-url https://account.plotspeaks.com/mcp`.
2. A static OAuth client for Alexa's service calls (`client_credentials`, scope `mcp:service`) on the
   account host, with the redirect URI the add-on console supplies.
3. Export the icon set (72, 64, 88, 126, 180, 241 px) and the 600×900 carousel image from the existing
   mark; fill the media URLs above.
4. `alexa-ai deploy`, test on an Echo, then `alexa-ai submit` for certification.
5. Echo Show: the Watch page (`https://plotspeaks.com/watch`) becomes the on-screen game view.

Plot Speaks already runs, unchanged, in Claude and Gemini; the same server will serve Alexa+.
