# riftctrl-codex

Aggregated reference data for **dedicated game servers**. Each dataset here answers a question no public
API answers completely, and each is published as plain JSON over the raw URL so anything can read it.

| Directory | What it answers |
|---|---|
| [`data/`](#steam-app-ids-data) | What is this game's Steam app id — *including* dedicated-server tool apps |
| [`commands/`](commands/) | How is this server commanded — list players, kick, ban, say, and over which transport |

Both are produced by scheduled GitHub Actions and are meant to be consumed, not cloned. Built for
[RIFT//CTRL](https://github.com/jmedina-ph/RIFT_CTRL), useful to any server manager.

---

## Steam app ids (`data/`)

RIFT resolves a game's Steam app id by searching a name against a merged app list. No public web API
gives a complete one:

- The keyed **IStoreService/GetAppList** (what jsnli and we use) is **store-gated** — it omits
  dedicated-server *tool* apps (they have no Store page). ~180k apps, but no Palworld server.
- The old keyless **ISteamApps/GetAppList/v2** that *did* list tools is **dead** (404 everywhere).
- **PICS** (Steam's internal catalog, what SteamDB crawls) is the only source of tool servers, but it
  can't be dumped all at once — only "what changed since X".

So this repo produces the union of two things:

1. **Base catalog** (`build-applist.mjs`) — the keyed IStoreService pull. Everything with a Store
   page.
2. **Dedicated servers** (`watch-servers.mjs`) — a PICS **watcher**: anonymous Steam login that, each
   run, records every changed app whose name looks like a server. Dedicated servers get patched
   whenever their game updates, so the ones the base catalog misses surface within days. No key, no
   scraping. It accumulates into `data/tracked_servers.json`, which can also be **seeded** once from
   an existing list for instant coverage.

`build-applist.mjs` unions the tracked servers into the base catalog and writes the single published
file `data/riftctrl_appid.json`. It logs whether Palworld Dedicated Server #2394010 made it in — a
real check that the server slice is working (no hand-adding).

### One-time setup

1. **Free Steam Web API key:** <https://steamcommunity.com/dev/apikey> → sign in → register any
   domain (e.g. `localhost`) → copy the key.
2. Repo **Settings → Secrets and variables → Actions → New repository secret**: name `STEAM_API_KEY`,
   value = your key.
3. **Settings → Actions → General → Workflow permissions → Read and write permissions → Save.**
4. **Actions → Publish Steam app list → Run workflow.** Read the log:
   - `[watch] ...` — the watcher's login + how many servers it tracked.
   - `[keyed] ... apps` — the base catalog pulled.
   - `[verify] #2394010 present — final: true/false` — whether the server slice has Palworld yet.

The watcher fills in over the first days on its own. To have current servers covered immediately,
**seed** `data/tracked_servers.json` once (RIFT will hand you a seeded file); its `applist.apps` is a
plain `[{appid,name}]` list the watcher then keeps growing.

### Wiring it into RIFT//CTRL

**This list is not read by default.** RIFT//CTRL ships three built-in app-id sources (jsnli games,
jsnli software, dgibbs64 SteamCMD) and this one is added by overriding them. On the Core, set the
app-list sources env for the `rift-ctrl-web` service so RIFT's list is source #1:

```
RIFT_CTRL_STEAM_APPLIST_SOURCES="riftctrl=https://raw.githubusercontent.com/jmedina-ph/riftctrl-codex/main/data/riftctrl_appid.json,jsnli-games=https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/games_appid.json,jsnli-software=https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/software_appid.json,dgibbs64=https://raw.githubusercontent.com/dgibbs64/SteamCMD-AppID-List/main/steamcmd_appid.json"
```

Restart the service, open `/steam-check` → **Refresh now**, and confirm a `riftctrl` row. Searching a
game whose server the watcher/seed has surfaced will show its dedicated server.

---

## Server-management commands (`commands/`)

One JSON file per game describing how that server is commanded — the transport it answers (RCON, a REST
admin API, stdin, or none at all) and the exact text for listing players, kicking, banning and
broadcasting.

This dataset exists because **nothing else publishes it.** The sources RIFT//CTRL aggregates for
installing and configuring a server — AMP templates, Pelican eggs, PufferPanel, LinuxGSM, WindowsGSM,
GameDig — none of them cover commanding one.

See [`commands/README.md`](commands/README.md) for the contract and
[`commands/schema.json`](commands/schema.json) for the authoritative schema.

---

## Maintenance

The app-list watcher runs itself and the list only grows. Command files are researched, approved by
hand, and committed by a scheduled job.

**Note for anyone editing the workflows:** two scheduled jobs push to `main` from this repo. Each must
stage only its own directory, and must `git pull --rebase origin main` before pushing — otherwise the
second one to finish is rejected and its run is silently lost.

## Licence

MIT — see [LICENSE](LICENSE). Data published here is free to use; please keep the attribution.
