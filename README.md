# claude-token-meter

English | [한국어](README.ko.md)

A Claude Code mod that shows where your tokens go and warns you before a long session gets expensive.

<!-- screenshot: efficiency pane (charts + weekly / 5-hour limit bars) -->
<!-- screenshot: token & tool check pane -->
<!-- screenshot: session-size alert band -->

## What it does

1. **Token efficiency pane** - charts of context size and efficiency per turn, plus weekly and 5-hour limit bars.
2. **Token & tool check pane** - shows what your connectors, plugins and MCP servers cost at session start, which of them were actually used, and lets you turn them on/off.
3. **Session-size alerts** - warns as efficiency drops (stepped alerts), warns when the start load is heavy, and counts down the prompt-cache expiry. Logs are written to `~/.claude/token-meter/` and trimmed automatically.

## Key idea

**Efficiency = start load ÷ current context.**
Every turn re-reads the whole context. As the conversation grows, the fixed start load (system prompt, tools, connectors) becomes a smaller share. Below about **40%**, starting a fresh session is usually cheaper than continuing.

## Install

At the prompt of a terminal session:

```
/plugin install claude-token-meter --marketplace eyu74368-boop/claude-token-meter
```

From a shell:

```
claude plugin install claude-token-meter --marketplace eyu74368-boop/claude-token-meter
```

In the desktop app (where `/plugin` does not run): click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `eyu74368-boop/claude-token-meter`, then **Add plugin**.

## Settings

| Option | Default | Meaning |
|---|---|---|
| `effWarn` | 40 | Efficiency warning line (%); red below this |
| `effCaution` | 50 | Efficiency caution line (%); orange below this |
| `alertSteps` | `40,30,22` | Comma-separated efficiency levels; an alert fires the first time efficiency drops below each |
| `wasteTokens` | 15000 | A turn that grows the context by more than this is logged as waste |
| `cacheTtlMin` | 60 | Prompt cache lifetime in minutes, for the expiry countdown |
| `cacheMinChat` | 40000 | Skip the cache-expiry alert when the conversation part is smaller than this (tokens) |
| `startPayload` | 60000 | Warn when the first response's input is larger than this (tokens) |
| `keepDays` | 30 | Rows older than this are trimmed from the log files |
| `language` | `auto` | `auto`, `en` or `ko` |

## Language

By default the mod follows Claude's `language` setting: Korean gives Korean, anything else gives English. Set the `language` option to `en` or `ko` to force one.

## Privacy

Everything stays on your machine. Nothing is sent anywhere. The mod writes in two places:

- `~/.claude/token-meter/`, its own logs (pruned automatically).
- `~/.claude/settings.json`, only when you switch a plugin on or off in the check pane. Claude Code has no API for this, so the mod changes the `enabledPlugins` entry for that plugin and leaves every other setting as it was. If you never use those switches, the file is never touched.

## Requirements

Claude Code with mods support (function hooks).

## License

MIT - see [LICENSE](LICENSE).
