The Rejourney MCP server lets Claude Code read your Rejourney data, in the terminal or in the Claude desktop app. You add the server once, sign in through the Rejourney website, and choose the team and projects to share. After that you can ask Claude Code about sessions, replays, crashes, ANRs and errors in plain language.

```text
https://mcp.rejourney.co/mcp
```

Three things are worth knowing before you connect:

- **It is read-only.** No tool can change, delete or create anything in Rejourney.
- **It makes no AI calls.** The server returns data and evidence. Claude Code does the reasoning and writes the answer.
- **It is metered in credits.** Every plan includes a monthly allowance. See [Limits and billing](/docs/mcp/limits-and-billing).

## Before you start

You need:

- A Rejourney account that is a member of a team with at least one project.
- Claude Code, in the terminal or in the Claude desktop app. There is no API key to create or paste: you sign in through your browser.

A team admin can turn MCP off for a team. While it is off, no one on the team can connect an app.

## Connect Claude Code in the terminal

Run this command in your terminal. `--scope user` makes Rejourney available in every project on this computer.

```bash
claude mcp add --transport http --scope user rejourney https://mcp.rejourney.co/mcp
```

Then sign in. Either start Claude Code and use the `/mcp` panel:

```text
/mcp
```

Choose `rejourney` and follow the steps in your browser. Or sign in from your shell without opening a session:

```bash
claude mcp login rejourney
```

To share the server with everyone who works in a repository, add it to the project's `.mcp.json` instead. Claude Code asks each person to approve it, and each person signs in with their own Rejourney account.

```json
{
  "mcpServers": {
    "rejourney": {
      "type": "http",
      "url": "https://mcp.rejourney.co/mcp"
    }
  }
}
```

## Connect Claude Code in the desktop app

Claude Code in the Code tab of the Claude desktop app uses the same configuration as the terminal on that computer.

1. Run the `claude mcp add ... --scope user ...` command above once in a terminal.
2. Open a new session in the Code tab and run `/mcp`.
3. Choose `rejourney` and sign in to Rejourney in the browser tab that opens.

If `rejourney` is not listed, start a new session after running the command.

Other AI clients are not supported.

## Sign in and choose what to share

The first time Claude Code connects, it opens a browser tab on rejourney.co.

1. **Sign in.** You sign in the way you already do, with an email code or with GitHub. If you are already signed in to the dashboard in that browser, this step is skipped.
2. **Review the consent screen.** It shows the name of the app that is asking for access and the host it will return you to. Check that the app is Claude Code and that you started this from Claude Code.
3. **Pick a team.** A connection belongs to exactly one team.
4. **Pick projects.** Share all of the team's projects or only the ones you select. The client can read nothing outside this list.
5. **Click Allow.** The browser hands control back to Claude Code, which is now connected.

## Check that it works

Ask Claude Code a question that needs no arguments:

```text
List my Rejourney projects.
```

Claude Code calls `list_projects` and shows the projects you shared. This call is free. To see your allowance, ask:

```text
How many Rejourney MCP credits do I have left?
```

Claude Code calls `get_usage`, which is also free. For more to try, see [What you can ask](/docs/mcp/what-you-can-ask).

## Built-in prompts

The server publishes three prompts. Clients that support MCP prompts show them as commands.

- `review_session` walks through one session and reports what the user did and where they struggled. It takes a session id.
- `triage_crash` explains one issue: what fails, who is affected, what leads up to it and what to check first. It takes an issue id.
- `weekly_stability_review` summarises the last seven days of stability and friction for one project. It takes a project id and uses about 20 credits.

In Claude Code, type `/` to find them, or run one directly:

```text
/mcp__rejourney__review_session <session id>
```

## Disconnect or revoke access

Revoke a connection from the **MCP** page in the Rejourney dashboard. It is in the sidebar under **Automations**.

1. Open the **MCP** page and find the app under **Connections**. Each row shows the app, who connected it, the projects it can read and when it was last used.
2. Open the connection and click **Revoke access**.

The app stops working at once. The person who connected an app can revoke it, and a team admin can revoke any connection in the team.

Access also ends without a revoke in these cases:

- You leave the team or are removed from it.
- A shared project is deleted. The other shared projects keep working.
- A team admin turns off **Allow MCP access for this team** in the MCP page's **Settings**. Every connected app in the team stops working.

Removing the server from Claude Code does not always revoke it on the Rejourney side. In Claude Code, sign out before you remove the server so the tokens are revoked as well:

```bash
claude mcp logout rejourney
claude mcp remove rejourney
```

In Claude, remove the connector under **Customize**, then **Connectors**. If you want to be sure a connection is closed, revoke it from the MCP page.

## Next steps

- [What you can ask](/docs/mcp/what-you-can-ask): example questions and the tools behind them.
- [Tool reference](/docs/mcp/tools): every tool, its arguments and its credit cost.
- [Limits and billing](/docs/mcp/limits-and-billing): credits, plan allowances and rate limits.
- [Security and privacy](/docs/mcp/security-and-privacy): what Claude Code can and cannot read.
