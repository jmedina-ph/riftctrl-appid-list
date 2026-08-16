# riftctrl-appid-list

The RIFT//CTRL Steam app-id list. A scheduled GitHub Action produces `data/riftctrl_appid.json`,
which the RIFT//CTRL dashboard reads (over the raw URL) as its **first** app-id source.

## Why this repo exists

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

## One-time setup

1. **Free Steam Web API key:** <https://steamcommunity.com/dev/apikey> → sign in → register any
   domain (e.g. `localhost`) → copy the key.
2. Put these files in a public repo named `riftctrl-appid-list` (preserve the folder layout).
3. Repo **Settings → Secrets and variables → Actions → New repository secret**: name `STEAM_API_KEY`,
   value = your key.
4. **Settings → Actions → General → Workflow permissions → Read and write permissions → Save.**
5. **Actions → Publish Steam app list → Run workflow.** Read the log:
   - `[watch] ...` — the watcher's login + how many servers it tracked.
   - `[keyed] ... apps` — the base catalog pulled.
   - `[verify] #2394010 present — final: true/false` — whether the server slice has Palworld yet.

The watcher fills in over the first days on its own. To have current servers covered immediately,
**seed** `data/tracked_servers.json` once (RIFT will hand you a seeded file); its `applist.apps` is a
plain `[{appid,name}]` list the watcher then keeps growing.

## Wire it into RIFT//CTRL

On the Core, set the app-list sources env for the `rift-ctrl-web` service so RIFT's list is source #1
(replace `<user>`):

```
RIFT_CTRL_STEAM_APPLIST_SOURCES="riftctrl=https://raw.githubusercontent.com/<user>/riftctrl-appid-list/main/data/riftctrl_appid.json,jsnli-games=https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/games_appid.json,jsnli-software=https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/software_appid.json,dgibbs64=https://raw.githubusercontent.com/dgibbs64/SteamCMD-AppID-List/main/steamcmd_appid.json"
```

Restart the service, open `/steam-check` → **Refresh now**, and confirm a `riftctrl` row. Searching a
game whose server the watcher/seed has surfaced will show its dedicated server.

## Maintenance

None day-to-day — the watcher runs itself and the list only grows.
