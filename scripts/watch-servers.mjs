// RIFT//CTRL dedicated-server WATCHER (PICS change-tracker).
//
// The problem: no web API lists tool-type dedicated servers (v2 is dead; the keyed IStoreService is
// store-gated; those servers have no Store page). PICS — Steam's internal product catalog, the same
// one SteamDB crawls — is the only source, but it can't be dumped all at once; it can only tell you
// "what changed since changenumber X". So we do what SteamDB does: log in anonymously and, every
// run, record every app that CHANGED whose name looks like a server. Dedicated servers get patched
// whenever their game updates, so the ones we're missing surface within days — no key, no scraping,
// no hand-maintained list. The result accumulates in data/tracked_servers.json (which may also be
// SEEDED once from an existing list for instant coverage) and is unioned into the published list.

import SteamUser from "steam-user";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TRACK_PATH = `${ROOT}/data/tracked_servers.json`;
const SERVER_NAME_RE = /\bserver\b/i; // keep apps whose name reads like a server
const INFO_BATCH = 1000; // getProductInfo appids per request
const LOGIN_TIMEOUT_MS = 60_000;

async function readTracked() {
  try {
    const doc = JSON.parse(await readFile(TRACK_PATH, "utf8"));
    const map = new Map();
    for (const a of doc?.applist?.apps ?? []) {
      const appid = Number(a?.appid);
      const name = typeof a?.name === "string" ? a.name.trim() : "";
      if (Number.isInteger(appid) && appid > 0 && name) {
        map.set(appid, { appid, name, type: a?.type ?? null });
      }
    }
    return { lastChangenumber: Number(doc?.lastChangenumber) || 0, map };
  } catch {
    return { lastChangenumber: 0, map: new Map() };
  }
}

function loginAnonymous() {
  return new Promise((resolve, reject) => {
    const client = new SteamUser();
    const timer = setTimeout(() => reject(new Error("Steam login timed out")), LOGIN_TIMEOUT_MS);
    client.once("loggedOn", () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    client.logOn({ anonymous: true });
  });
}

async function main() {
  const { lastChangenumber, map } = await readTracked();
  const seeded = map.size;
  const client = await loginAnonymous();
  console.log(`[watch] logged on anonymously · seeded=${seeded} · lastChangenumber=${lastChangenumber}`);

  // What changed since we last looked (or a baseline on first run)?
  let currentChangenumber = lastChangenumber;
  let changedAppids = [];
  try {
    const res = await client.getProductChanges(lastChangenumber);
    currentChangenumber = Number(res?.currentChangenumber ?? res?.currentChangeNumber ?? lastChangenumber);
    const appChanges = res?.appChanges ?? res?.apps ?? [];
    changedAppids = appChanges.map((c) => Number(c?.appid)).filter((n) => Number.isInteger(n) && n > 0);
    console.log(`[watch] ${changedAppids.length} changed apps · now at changenumber ${currentChangenumber}`);
  } catch (err) {
    console.log(`[watch] getProductChanges failed: ${err?.message ?? err}`);
  }

  // Look up only appids we don't already know, in batches; keep the server-named ones.
  const toLookup = [...new Set(changedAppids)].filter((id) => !map.has(id));
  let added = 0;
  for (let i = 0; i < toLookup.length; i += INFO_BATCH) {
    const batch = toLookup.slice(i, i + INFO_BATCH);
    let apps;
    try {
      ({ apps } = await client.getProductInfo(batch, []));
    } catch (err) {
      console.log(`[watch] getProductInfo batch @${i} failed: ${err?.message ?? err}`);
      continue;
    }
    for (const [id, entry] of Object.entries(apps ?? {})) {
      const common = entry?.appinfo?.common;
      const name = typeof common?.name === "string" ? common.name.trim() : "";
      const type = typeof common?.type === "string" ? common.type.toLowerCase() : null;
      if (name && SERVER_NAME_RE.test(name)) {
        map.set(Number(id), { appid: Number(id), name, type });
        added += 1;
      }
    }
  }
  console.log(`[watch] added ${added} new server-named apps · tracked total ${map.size}`);

  try {
    client.logOff();
  } catch {
    /* ignore */
  }

  const servers = [...map.values()].sort((a, b) => a.appid - b.appid);
  await mkdir(dirname(TRACK_PATH), { recursive: true });
  const doc = {
    lastChangenumber: currentChangenumber,
    updatedAt: new Date().toISOString(),
    count: servers.length,
    applist: { apps: servers },
  };
  await writeFile(TRACK_PATH, JSON.stringify(doc), "utf8");
  console.log(`[watch] wrote ${servers.length} tracked servers → data/tracked_servers.json`);
  process.exit(0);
}

// Non-fatal: a Steam blip must not break the store-list build that runs after this.
main().catch((err) => {
  console.log(`::warning::watcher skipped this run: ${err?.message ?? err}`);
  process.exit(0);
});
