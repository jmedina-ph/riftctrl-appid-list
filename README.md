# riftctrl-appid-list

The RIFT//CTRL Steam app-id list. A GitHub Action refreshes `data/riftctrl_appid.json` daily; the
RIFT//CTRL dashboard consumes it (over the raw URL) as its **first** app-id source.
## Why this exists

RIFT resolves a game's Steam app id by searching a name against a merged app list. The public lists
we already use have gaps for **dedicated-server "tool" apps**:


And the old keyless full-list endpoint (`ISteamApps/GetAppList/v2`) is **dead** (HTTP 404, verified
from the Core). So this repo pulls the **current** full list from Steam's maintained
`IStoreService/GetAppList` and publishes it.

## What the generator does (`scripts/build-applist.mjs`)

One thing, cleanly: paginate `IStoreService/GetAppList` with a Steam Web API key and write exactly
what it returns to `data/riftctrl_appid.json` (in `{applist:{apps:[{appid,name}]}}` form). **No
keyless fallback, no seeding, no supplement** — the published list *is* the pull, so it's
verifiable.

It logs one verification line: whether **Palworld Dedicated Server #2394010** — a known Tool-type
server missing from the public lists — is in the pull. That's how we confirm the endpoint actually
covers server tools. We do **not** add it by hand; if it's missing, the log says so and we fix the
real cause (endpoint params / an additional source) rather than masking it.

## One-time setup

1. **Get a free Steam Web API key:** <https://steamcommunity.com/dev/apikey> → sign in → register
   any domain (e.g. `localhost`) → copy the key. Free; used only by this daily job, never by end
   users.
2. **Create a new public GitHub repo** named `riftctrl-appid-list` and add these files
   (`scripts/`, `.github/`, `data/`, this README), preserving the layout.
3. In the repo: **Settings → Secrets and variables → Actions → New repository secret**, name it
   `STEAM_API_KEY`, paste the key.
4. **Actions** tab → **Publish Steam app list** → **Run workflow**.
5. **Read the run log:**
   - `[keyed] page N: …` lines and `[main] wrote <N> apps` → success, the list is committed.
   - `[verify] #2394010 … present: true` → the pull covers tool-type servers (what we want).
   - `[verify] … present: false` (a `::warning::`) → the keyed endpoint under-covers tools; **stop
     and tell RIFT** — we decide the real fix, we do not seed it.

## Wire it into RIFT//CTRL

Only after a run shows `present: true`. On the Core, set the app-list sources env for the
`rift-ctrl-web` service so RIFT's list is source #1 (replace `<user>`):

```
RIFT_CTRL_STEAM_APPLIST_SOURCES="riftctrl=https://raw.githubusercontent.com/<user>/riftctrl-appid-list/main/data/riftctrl_appid.json,jsnli-games=https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/games_appid.json,jsnli-software=https://raw.githubusercontent.com/jsnli/steamappidlist/master/data/software_appid.json,dgibbs64=https://raw.githubusercontent.com/dgibbs64/SteamCMD-AppID-List/main/steamcmd_appid.json"
```

Then restart the service, open `/steam-check`, click **Refresh now**, and confirm a `riftctrl` row
with a large count. Searching **"palworld"** should now surface the dedicated server (#2394010) —
the end-to-end proof that RIFT's own list closed the gap.

## Maintenance

None day-to-day — the Action runs itself. The published list is always a straight pull; there is no
hand-maintained list to keep in sync.
