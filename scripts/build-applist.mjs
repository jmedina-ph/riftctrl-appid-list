// RIFT//CTRL Steam app-list generator.
//
// Publishes a daily JSON app list that RIFT//CTRL consumes as its first app-id source. The goal is
// a CURRENT list that includes dedicated-server "tool" apps (e.g. Palworld Dedicated Server
// #2394010) — which the store-gated keyed endpoint does NOT return, so a bulk source that isn't
// store-gated is required.
//
// Two candidate sources, both tried, results reported per-source (NO seeding — the published list
// is exactly what the sources return, so #2394010's presence is a real verification):
//   1. steam-v2  — keyless ISteamApps/GetAppList/v2. This is the raw, non-store-gated full list that
//      historically included Tools. It 404s from the Core, but GitHub's runner is on a different
//      network and may reach it — that's the whole reason to try it here.
//   2. keyed     — IStoreService/GetAppList (optional STEAM_API_KEY). Current + broad but STORE-GATED
//      (confirmed to omit tool-type servers). Kept as a freshness/coverage floor for store apps.
//
// If neither yields #2394010, the log says so plainly and the next step is Steam PICS (the client
// protocol) — we do NOT hand-add it.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_PATH = `${ROOT}/data/riftctrl_appid.json`;
const VERIFY_APPID = 2394010; // Palworld Dedicated Server — the known Tool server we verify against.

const V2_URL = "https://api.steampowered.com/ISteamApps/GetAppList/v2/";
const STORESERVICE_URL = "https://api.steampowered.com/IStoreService/GetAppList/v1/";

function clean(apps) {
  const out = [];
  for (const app of apps ?? []) {
    const appid = Number(app?.appid);
    const name = typeof app?.name === "string" ? app.name.trim() : "";
    if (Number.isInteger(appid) && appid > 0 && name) out.push({ appid, name });
  }
  return out;
}

const has = (apps) => apps.some((a) => a.appid === VERIFY_APPID);

/** Source 1: keyless raw full list. Never throws — reports ok/count and whether it carries the
 * verify app, so we learn if GitHub can reach what the Core can't. */
async function fetchV2() {
  try {
    const res = await fetch(V2_URL, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      console.log(`[v2] HTTP ${res.status} — v2 did not respond from this runner`);
      return [];
    }
    const apps = clean((await res.json())?.applist?.apps);
    console.log(`[v2] ok: ${apps.length} apps · #${VERIFY_APPID} present: ${has(apps)}`);
    return apps;
  } catch (err) {
    console.log(`[v2] failed: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/** Source 2: keyed, paginated store list. Returns [] if no key; throws only on a mid-pull HTTP
 * error (so we don't publish a silently-truncated list). */
async function fetchKeyed(key) {
  if (!key) {
    console.log("[keyed] no STEAM_API_KEY — skipping keyed source");
    return [];
  }
  const byId = new Map();
  let lastAppid = 0;
  for (let page = 0; page < 200; page += 1) {
    const url =
      `${STORESERVICE_URL}?key=${encodeURIComponent(key)}` +
      `&include_games=true&include_dlc=false&include_software=true` +
      `&include_videos=false&include_hardware=false&max_results=50000&last_appid=${lastAppid}`;
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`IStoreService page ${page} → HTTP ${res.status}`);
    const response = (await res.json())?.response;
    for (const app of clean(response?.apps)) if (!byId.has(app.appid)) byId.set(app.appid, app);
    if (!response?.have_more_results || !response?.last_appid) break;
    lastAppid = response.last_appid;
  }
  const apps = [...byId.values()];
  console.log(`[keyed] ok: ${apps.length} apps · #${VERIFY_APPID} present: ${has(apps)}`);
  return apps;
}

/** Union by appid, first writer wins the name, sorted by appid. */
function union(...lists) {
  const byId = new Map();
  for (const list of lists) for (const app of list) if (!byId.has(app.appid)) byId.set(app.appid, app);
  return [...byId.values()].sort((a, b) => a.appid - b.appid);
}

async function main() {
  const v2 = await fetchV2();
  const keyed = await fetchKeyed(process.env.STEAM_API_KEY);

  const merged = union(v2, keyed);
  if (merged.length === 0) {
    throw new Error("No source returned any apps (v2 unreachable AND no/failed keyed pull).");
  }

  const finalHas = has(merged);
  console.log(
    `[verify] #${VERIFY_APPID} present — final: ${finalHas} · v2: ${has(v2)} · keyed: ${has(keyed)}`,
  );
  if (!finalHas) {
    console.log(
      `::warning::#${VERIFY_APPID} in NO source (v2 unreachable/omits it, keyed is store-gated). ` +
        `Do NOT seed. Next real fix: Steam PICS enumeration.`,
    );
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const document = {
    generatedAt: new Date().toISOString(),
    sources: { v2: v2.length, keyed: keyed.length },
    count: merged.length,
    applist: { apps: merged },
  };
  await writeFile(OUT_PATH, JSON.stringify(document), "utf8");
  console.log(`[main] wrote ${merged.length} apps → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
