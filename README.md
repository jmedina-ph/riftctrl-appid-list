# riftctrl-codex

The aggregate cache for [RIFT//CTRL](https://github.com/jmedina-ph/RIFT_CTRL) — reference data about
**dedicated game servers**, published as plain JSON over the raw URL so anything can read it.

RIFT//CTRL installs and configures game servers without hand-written per-game profiles, by aggregating
public sources at runtime (CubeCoders AMP templates, Pelican eggs, PufferPanel, LinuxGSM, WindowsGSM,
GameDig). This repo is for the facts those sources **don't** carry, and which nothing else publishes in
machine-readable form.

| Directory | Status | What it holds |
|---|---|---|
| [`commands/`](commands/) | **Active** | How each server is commanded — list players, kick, ban, say, and over which transport |
| [`data/`](#steam-app-ids-data--legacy) | Legacy | Steam app ids, including dedicated-server tool apps. Superseded; see below |

---

## Server-management commands (`commands/`)

One JSON file per game describing how that server is commanded: the transport it answers — RCON, a REST
admin API, stdin, or **none at all** — and the exact command text for listing players, kicking, banning
and broadcasting.

This is the dataset the repo now exists for, because **nothing else publishes it.** Every source
RIFT//CTRL aggregates covers *installing and configuring* a server. None of them cover *commanding* one.
That gap is why these files are researched rather than fetched, and why each carries its sources and a
confidence level with it.

See [`commands/README.md`](commands/README.md) for the contract and
[`commands/schema.json`](commands/schema.json) for the authoritative schema.

---

## Steam app ids (`data/`) — legacy

**This dataset is not consumed by anything, and is kept for reference rather than use.**

It was built when app-id resolution looked like a problem RIFT//CTRL would have to solve itself. The
concern was real: the keyed **IStoreService/GetAppList** is store-gated and omits dedicated-server *tool*
apps (~180k apps, but no Palworld server); the old keyless **ISteamApps/GetAppList/v2** that did list
tools is dead; and **PICS**, the only source of tool servers, can't be dumped whole — only "what changed
since X". So this repo pairs a keyed base-catalog pull (`build-applist.mjs`) with a PICS watcher
(`watch-servers.mjs`) that accumulates dedicated servers into `data/tracked_servers.json` as they get
patched, and unions the two into `data/riftctrl_appid.json`.

It works. It simply turned out not to be needed: RIFT//CTRL resolves app ids from three public lists
(jsnli games, jsnli software, dgibbs64 SteamCMD) that cover the cases in practice, and the
`RIFT_CTRL_STEAM_APPLIST_SOURCES` override that would put this list in front of them is not set on any
Core. The scheduled job still runs and the file is still current, so the option remains open — but
nothing reads it today, and the README previously claimed otherwise.

To actually use it, set that env for the `rift-ctrl-web` service so this list is source #1:

```
RIFT_CTRL_STEAM_APPLIST_SOURCES="riftctrl=https://raw.githubusercontent.com/jmedina-ph/riftctrl-codex/main/data/riftctrl_appid.json,jsnli-games=https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/games_appid.json,jsnli-software=https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/software_appid.json,dgibbs64=https://raw.githubusercontent.com/dgibbs64/SteamCMD-AppID-List/main/steamcmd_appid.json"
```

Restart the service, open `/steam-check` → **Refresh now**, and confirm a `riftctrl` row.

The job needs a free Steam Web API key (<https://steamcommunity.com/dev/apikey>) as the `STEAM_API_KEY`
repo secret, and **Settings → Actions → General → Workflow permissions → Read and write**.

---

## Maintenance

Command files are researched, approved by hand, and committed by a scheduled job. The app-list watcher
runs itself and its list only grows.

**Note for anyone editing the workflows:** two scheduled jobs push to `main` from this repo. Each must
stage only its own directory, and must rebase-and-retry on a rejected push — otherwise the second one to
finish is rejected non-fast-forward and its run is silently lost.

## Licence

MIT — see [LICENSE](LICENSE). Free to use; please keep the attribution.
