// RIFT//CTRL app-list builder — publishes data/riftctrl_appid.json, the single file RIFT consumes.
//
// It's the UNION of two things this repo produces:
//   1. keyed  — the current base catalog from IStoreService/GetAppList (STEAM_API_KEY). ~180k apps:
//      games + software. Store-gated, so it does NOT include tool-type dedicated servers.
//   2. tracked — data/tracked_servers.json, the dedicated servers the PICS watcher accumulates (and
//      any one-time seed). This is what fills the tool-server gap the keyed list can't.
//
// (The old keyless ISteamApps/GetAppList/v2 is dead everywhere — 404 from the Core AND from GitHub —
// so it's gone.) No seeding here; #2394010's presence is a real signal of whether the watcher/seed
// has done its job.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_PATH = `${ROOT}/data/riftctrl_appid.json`;
const TRACK_PATH = `${ROOT}/data/tracked_servers.json`;
const VERIFY_APPID = 2394010; // Palworld Dedicated Server — verify the server slice is working.

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

/** Base catalog: keyed, paginated store list. [] if no key. Throws on a mid-pull HTTP error. */
async function fetchKeyed(key) {
  if (!key) {
    console.log("[keyed] no STEAM_API_KEY — skipping base catalog");
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
  console.log(`[keyed] ${apps.length} apps · #${VERIFY_APPID} present: ${has(apps)}`);
  return apps;
}

/** Dedicated servers the watcher (and any seed) have accumulated. */
async function readTrackedServers() {
  try {
    const doc = JSON.parse(await readFile(TRACK_PATH, "utf8"));
    const apps = clean(doc?.applist?.apps);
    console.log(`[tracked] ${apps.length} servers · #${VERIFY_APPID} present: ${has(apps)}`);
    return apps;
  } catch {
    console.log("[tracked] none yet");
    return [];
  }
}

function union(...lists) {
  const byId = new Map();
  for (const list of lists) for (const app of list) if (!byId.has(app.appid)) byId.set(app.appid, app);
  return [...byId.values()].sort((a, b) => a.appid - b.appid);
}

async function main() {
  const keyed = await fetchKeyed(process.env.STEAM_API_KEY);
  const tracked = await readTrackedServers();

  const merged = union(tracked, keyed); // tracked first so curated server names win
  if (merged.length === 0) {
    throw new Error("No apps to publish (no key and no tracked servers).");
  }

  const finalHas = has(merged);
  console.log(`[verify] #${VERIFY_APPID} present — final: ${finalHas} · keyed: ${has(keyed)} · tracked: ${has(tracked)}`);
  if (!finalHas) {
    console.log(`::warning::#${VERIFY_APPID} still missing — the watcher hasn't caught it yet (or add a seed).`);
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const document = {
    generatedAt: new Date().toISOString(),
    sources: { keyed: keyed.length, tracked: tracked.length },
    count: merged.length,
    applist: { apps: merged },
  };
  await writeFile(OUT_PATH, JSON.stringify(document), "utf8");
  console.log(`[main] wrote ${merged.length} apps → data/riftctrl_appid.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
