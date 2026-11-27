This page describes what Claude Code connected to the Rejourney MCP server can read, what it can never read, and how you cut it off.

## Read-only

Every tool reads data. No tool creates, changes or deletes anything in Rejourney, and each tool is declared read-only to the client. A connected client cannot resolve an issue, delete a session, change a setting or invite a member.

## No AI on the server

The server makes no AI or LLM calls. It selects data by fixed rules and returns it. All reasoning happens in Claude Code and the model it uses.

Data returned by a tool goes to Claude Code, and from there to the model provider Claude Code is configured with. Rejourney does not control what happens to it after that, so connect only Claude Code accounts your team is allowed to use with this data.

## What a connection can read

A connection is the combination of one user, one team, the projects picked on the consent screen and a set of read scopes. It can read, for those projects only:

- sessions and their details;
- session timelines: screens, taps with their labels, rage and dead taps, failed and slow requests, errors, custom events and log lines;
- crashes, ANRs and errors, with stack traces and affected versions and devices;
- issue groups and project health figures;
- the team's MCP usage.

The scopes are `sessions:read`, `replay:read`, `issues:read` and `analytics:read`. The session tools need `sessions:read` and the issue and crash tools need `issues:read`. `list_projects` and `get_usage` work with any valid connection.

## Access is checked on every call

A token records what you approved when you connected. Before each tool call the server checks what is still true:

- that you are still a member of the team;
- that each shared project still exists, still belongs to that team and has not been deleted.

If you have left the team, calls fail with the error code `access_revoked`. A deleted project drops out of the connection and the other projects keep working. The check is repeated within a few seconds, so removing a member cuts off their connections almost immediately.

Every query the server runs is filtered to the projects of the connection. Anything outside it, including another team's data, returns the same `Not found.` answer as something that does not exist, so a client cannot learn whether an id belongs to someone else.

## Sign-in and tokens

Claude Code signs in with OAuth 2.1 and PKCE on the Rejourney website. You never give it your Rejourney credentials, and there is no long-lived API key.

- **Only Claude Code can sign in.** Rejourney accepts the client identity Claude Code publishes and no other, so an unknown app cannot even reach the consent screen.
- **Only the browser that started a sign-in can finish it,** and only while you are signed in to Rejourney as the person who clicked Allow.

- **Access tokens last 1 hour.**
- **Refresh tokens rotate on every use** and expire after 30 days without use. If an old refresh token is presented again, the whole connection is revoked.
- **Tokens only work at the MCP endpoint.** They are issued for `https://mcp.rejourney.co/mcp` and are rejected everywhere else.
- **The MCP endpoint only accepts its own tokens.** It never reads cookies and refuses dashboard session tokens.
- **Tokens are stored hashed** and are kept out of logs and URLs.

If a token is stolen, it is limited to the projects you shared, to reading, to one hour of life and to the team's remaining credits. Revoking the connection on the MCP page stops it within a few seconds.

Rejourney sends you an email when a new app is connected to your account.

## What is never returned

Each tool has a fixed list of output fields. Anything not on the list is dropped before the result leaves the server. The following never appear in a result:

- storage URLs, object keys, bucket names and storage endpoints;
- API keys, tokens and other secrets;
- raw device ids and IP addresses;
- precise coordinates. Location is limited to country and city;
- team members' email addresses;
- billing details and payment provider ids;
- internal error text. Errors carry a short public message and a request id.

Timelines leave out some recorded data by design:

- **Typed text** is not included. An input event says that typing happened, not what was typed.
- **Tap coordinates** are not included.
- **Successful requests** are not included unless they took 3,000 ms or longer.
- **User-property and identity events** are not included.

The only links in a result point to the Rejourney dashboard. They are ordinary dashboard pages that require a sign-in, not links to stored replay files.

## Secret scrubbing

Recorded text can contain secrets that your app logged or put in a URL. Before any recorded text is returned, the server:

- reduces network URLs to host and path, removing the scheme, credentials, query string and fragment;
- replaces bearer and basic authorization values, JWTs, values of fields such as `token`, `api_key` and `password`, vendor-style keys, UUID-shaped strings, long random-looking strings and base64 blobs with `[redacted]`;
- replaces card-shaped numbers that pass a checksum with `[redacted]`;
- shortens long values to a fixed maximum length.

Scrubbing is pattern-based and cannot recognise every secret. Keep using the SDK privacy controls so that sensitive values are not recorded in the first place.

## Identifier masking

By default a client receives end-user identifiers as they appear in the dashboard. A user id can be an email address if that is what your app sets. A team admin can turn on **Mask end-user identifiers and location** in the MCP page's **Settings**. With masking on:

- user ids are replaced with `[redacted]`;
- the device hash is replaced with `[redacted]`;
- city-level location is replaced with `[redacted]`. Country is still returned;
- email addresses found inside any recorded text are replaced with `[redacted]`;
- filtering sessions by user id is not available, so a client cannot confirm an id by probing.

Without masking, a device is still never identified by its raw id. Results carry a short hash that is stable within a project.

## Retention

MCP reads the same stored data as the dashboard and does not keep anything longer. When data passes your plan's retention, tools say so instead of failing:

- A session whose recorded events have been removed returns `eventStream: "expired"`. Its timeline then holds only crashes, ANRs, errors and stored custom events.
- A session whose replay is past retention reports the replay as unavailable with the reason `expired`. The session's facts and counts are still returned.
- A crash, ANR or error whose session is gone returns no session and `eventStream: "no_session"`. The stack and device details are still returned.

The values of `eventStream` are explained in the [tool reference](/docs/mcp/tools#event-stream-status).

## Recorded content is untrusted

Screen names, tap labels, log lines, error messages and custom event names are recorded on your end users' devices. Someone could put text there that is written to steer an AI model, for example a label that reads like an instruction. Treat everything in a tool result as data, never as instructions.

The server reduces this risk in several ways:

- Recorded text is returned as values of named fields, shortened, with control and invisible characters removed.
- Markdown link and image syntax and HTML tags in recorded text are made inert, so a hostile label cannot make a client load an outside URL.
- No tool accepts a URL or makes an outbound request.
- The server's instructions, and the description of every tool that returns recorded content, tell the client to treat that content as data.
- Because access is read-only, a successful injection cannot change your Rejourney data.

The remaining risk is in Claude Code. If the same client also has tools that can write, send or deploy, review what it does after reading Rejourney data, and keep its confirmation prompts on.

## Visibility

- The MCP page lists every connection with the app, the person who connected it, the shared projects and the last use. Members see their own connections. Team admins see all connections in the team.
- The **Activity** view lists recent calls with the tool, the user, the credits, the time and the outcome.
- Connecting, revoking and every tool call are written to the audit log with the tool, user, project, credits, size and outcome. Response bodies are not logged.

## Revoke access

Open the **MCP** page in the dashboard, under **Automations**, find the app under **Connections**, open it and click **Revoke access**. The app stops working at once. The person who connected an app can revoke it, and a team admin can revoke any connection in the team.

A team admin can also turn off **Allow MCP access for this team** in the MCP page's **Settings**. Every connected app in the team stops working and no one can connect a new one.

See [Getting started](/docs/mcp/getting-started#disconnect-or-revoke-access) for how to remove the server from each client.
