// RIFT//CTRL Steam app-list generator — clean KEYED build.
//
// Publishes a daily JSON app list that RIFT//CTRL consumes as its first app-id source. It pulls the
// CURRENT full list straight from Steam's maintained IStoreService/GetAppList (paginated), using a
// Steam Web API key. That's the only endpoint that's both current AND lets us fetch everything: the
// old keyless ISteamApps/GetAppList/v2 is confirmed dead (HTTP 404), and the public community lists
// either drop dedicated-server "tool" apps (jsnli) or froze in 2023 (dgibbs64).
//
// NO seeding, NO supplement, NO fallbacks that mask the source. The published list is EXACTLY what
// the keyed endpoint returns, so its correctness is verifiable: after it's wired into RIFT, a known
// item that was missing from the public lists — Palworld Dedicated Server #2394010 — either appears
// (the pull works AND covers tool-type servers) or it doesn't (we learned the endpoint's real
// coverage, honestly, and design the fix from there). The script LOGS that check; it never adds it.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_PATH = `${ROOT}/data/riftctrl_appid.json`;
const VERIFY_APPID = 2394010; // Palworld Dedicated Server — the known-missing item we verify against.

const STORESERVICE_URL = "https://api.steampowered.com/IStoreService/GetAppList/v1/";

/** Normalise {appid,name}-ish rows into clean {appid:number,name:string}, dropping junk. */
function clean(apps) {
  const out = [];
  for (const app of apps ?? []) {
    const appid = Number(app?.appid);
    const name = typeof app?.name === "string" ? app.name.trim() : "";
    if (Number.isInteger(appid) && appid > 0 && name) out.push({ appid, name });
  }
  return out;
}

/** Pull the full list from IStoreService/GetAppList, following the last_appid cursor. Throws on any
 * failure — a partial or empty list must NOT be published silently. */
async function fetchKeyed(key) {
  const byId = new Map();
  let lastAppid = 0;
  for (let page = 0; page < 200; page += 1) {
    const url =
      `${STORESERVICE_URL}?key=${encodeURIComponent(key)}` +
      `&include_games=true&include_dlc=false&include_software=true` +
      `&include_videos=false&include_hardware=false&max_results=50000&last_appid=${lastAppid}`;
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new Error(`IStoreService/GetAppList page ${page} → HTTP ${res.status}`);
    }
    const response = (await res.json())?.response;
    const apps = clean(response?.apps);
    for (const app of apps) if (!byId.has(app.appid)) byId.set(app.appid, app);
    console.log(`[keyed] page ${page}: +${apps.length} (unique so far ${byId.size})`);
    if (!response?.have_more_results || !response?.last_appid) break;
    lastAppid = response.last_appid;
  }
  return [...byId.values()].sort((a, b) => a.appid - b.appid);
}

async function main() {
  const key = process.env.STEAM_API_KEY;
  if (!key) {
    throw new Error(
      "STEAM_API_KEY is required. Add it as a repo secret (Settings → Secrets and variables → " +
        "Actions). Get a free key at https://steamcommunity.com/dev/apikey.",
    );
  }

  const apps = await fetchKeyed(key);
  if (apps.length === 0) {
    throw new Error("IStoreService returned no apps — refusing to publish an empty list.");
  }

  // VERIFICATION SIGNAL ONLY — we do not add it. Whether the pull covered the known tool-type
  // server tells us if this endpoint is sufficient on its own.
  const coversKnownTool = apps.some((a) => a.appid === VERIFY_APPID);
  console.log(`[verify] #${VERIFY_APPID} (Palworld Dedicated Server) present: ${coversKnownTool}`);
  if (!coversKnownTool) {
    console.log(
      `::warning::#${VERIFY_APPID} NOT in the keyed pull — IStoreService under-covers tool-type ` +
        `servers; do NOT seed it, decide the real fix (endpoint params / additional source).`,
    );
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const document = {
    generatedAt: new Date().toISOString(),
    source: "IStoreService/GetAppList",
    count: apps.length,
    applist: { apps },
  };
  await writeFile(OUT_PATH, JSON.stringify(document), "utf8");
  console.log(`[main] wrote ${apps.length} apps → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
