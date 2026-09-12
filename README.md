# riftctrl-codex

The aggregate cache for [RIFT//CTRL](https://github.com/jmedina-ph/RIFT_CTRL) — reference data about
**dedicated game servers**, published as plain JSON over the raw URL so anything can read it.

RIFT//CTRL installs and configures game servers without hand-written per-game profiles, by aggregating
public sources at runtime (CubeCoders AMP templates, Pelican eggs, PufferPanel, LinuxGSM, WindowsGSM,
GameDig). This repo holds what those sources don't carry.

| Directory | What it holds |
|---|---|
| [`commands/`](commands/) | How each server is commanded — list players, kick, ban, say, and over which transport |
| `data/` | Steam app ids, including dedicated-server tool apps |

More datasets will live here. Each is published on its own, so a consumer takes only what it needs.

---

## Server-management commands (`commands/`)

One JSON file per game describing how that server is commanded: the transport it answers — RCON, a REST
admin API, stdin, or **none at all** — and the exact command text for listing players, kicking, banning
and broadcasting.

Nothing else publishes this. Every source RIFT//CTRL aggregates covers *installing and configuring* a
server; none of them cover *commanding* one. That gap is why these files are researched rather than
fetched, and why each carries its sources and a confidence level with it.

- [`commands/README.md`](commands/README.md) — the contract, and the rules that aren't obvious
- [`commands/schema.json`](commands/schema.json) — the authoritative schema (JSON Schema draft-07)

Files are researched, approved by hand, and committed by a scheduled job. Approval is a human step on
purpose: the cost of a wrong command is a moderation action that appears to work and does nothing.

---

## Steam app ids (`data/`)

`data/riftctrl_appid.json` is the union of two things: a keyed **IStoreService/GetAppList** pull
(`build-applist.mjs`), which covers everything with a Store page, and a **PICS** watcher
(`watch-servers.mjs`), which catches dedicated-server *tool* apps as they get patched — those have no
Store page, so the keyed catalog omits them entirely, and the old keyless endpoint that listed them is
dead.

A consumer can read it over the raw URL. In RIFT//CTRL it is opt-in, via the
`RIFT_CTRL_STEAM_APPLIST_SOURCES` env for the `rift-ctrl-web` service.

The job runs on demand (**Actions → Publish Steam app list → Run workflow**) and needs a free Steam Web
API key (<https://steamcommunity.com/dev/apikey>) as the `STEAM_API_KEY` repo secret.

---

## Notes for anyone editing the workflows

Jobs here push to `main`. Each must stage only its own directory, and must rebase-and-retry on a rejected
push — otherwise a job that loses the race is rejected non-fast-forward and its run is silently lost.
`publish-applist.yml` has the pattern.

## Licence

MIT — see [LICENSE](LICENSE). Free to use; please keep the attribution.
