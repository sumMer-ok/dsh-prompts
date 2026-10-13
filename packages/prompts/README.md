# @deepseek-ai/dsh-prompts

Prompt library for DeepSeek Harness: input-assist prompts, never injected into model context.

## Model Experience

Zero model/token impact: prompts live outside every model request. Content reaches a model only after the user inserts it into the composer and sends it as an ordinary user message. No system-prompt injection, no session events, no agent-loop changes.

## Install

```sh
node <dsh-cli>/bin.js plugin --profile web add /path/to/dsh-prompts-plugin
```

Then fully restart the DeepSeek Harness app (the host half needs a process restart; the browser half hot-reloads).

## Data

`<dshHome>/prompts.json` (atomic staged writes; single-user sequential-write store, no file lock — same trade as the agent-profile TeamStore). Browser localStorage is never used (the desktop shell's random port origin loses localStorage across restarts).

## Wire API

All POST JSON under `/prompts-api`; envelope `{payload}` and bare bodies both accepted; responses `{ok:true,result}` / `{ok:false,error:{code,message}}`:

| Method | Body | Result |
|---|---|---|
| `prompts.list` | `{}` | `{prompts: Prompt[]}` |
| `prompts.create` | `{title, content, note?, tags?}` | `{prompt}` |
| `prompts.update` | `{id, patch:{title?,content?,note?,tags?,favorite?}}` | `{prompt}` |
| `prompts.delete` | `{id}` | `{deleted:true}` |
| `prompts.use` | `{id}` | `{prompt}` (useCount+1, lastUsedAt; updatedAt untouched) |

Error codes: `not-found` / `bad-request` / `internal` (always HTTP 200).

## Surfaces

- Slash panel: typing `/` offers prompt candidates plus the `prompts` panel entry; picking one opens the conversation-input dock panel (browse / temp-edit / insert — insertion replaces the trigger span under the draft's CAS, never touches other draft text).
- Save-as-prompt: turn-tail chip + modal (sent message), and the dock panel's draft save. The chip is opportunistic: `conversation.chat.turnTail` is a takeover chain, so it yields to higher-priority electors on the same turn tail; the reliable sent-message save is the panel footer entry `保存上一条发送的消息`.
- Management tab (提示词) in the dsh-agent-profile 拓展 page, contributed through that page's `agent-profile.extensions.tab` list slot (declared by agent-profile's sidebar registration). The inject waits on the declaration: without dsh-agent-profile the tab is simply absent. The tab body inherits the page root's `.dsp-scope`/`.dsp-scope-dark` theme layer, so light/dark follow the extensions page with no wiring of its own.

## Known Limitations and Deferred Work

- No variable placeholders, JSON import/export, version history, or Cmd/Ctrl+K panel — phase 2 per the PRD.
- Switching away from the 提示词 tab and back remounts it (search query, tag filter, and an open editor reset); sibling built-in tabs in the extensions page behave the same way.
