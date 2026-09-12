// End-to-end test of publish-approved.mjs against a mock Trello API. Run: node test/publish.test.mjs
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
const execFileP = promisify(execFile);
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'scripts', 'publish-approved.mjs');
const fx = (n) => JSON.parse(readFileSync(join(here, 'fixtures', n), 'utf8'));
const SCHEMA = join(here, '..', 'commands', 'schema.json');
const rust = JSON.parse(readFileSync(join(here, '..', 'commands', 'rust.json'), 'utf8'));
const desc = (d) => 'Proposed by Cowork\n\n```json\n' + JSON.stringify(d) + '\n```';

const LIST = 'approved1', ME = 'justin', OTHER = 'mallory';
const move = (who, date, app = null) => ({ type: 'updateCard', date, idMemberCreator: who, appCreator: app, data: { listBefore: { id: 'proposed' }, listAfter: { id: LIST } } });
const edit = (who, date) => ({ type: 'updateCard', date, idMemberCreator: who, appCreator: null, data: { old: { desc: '' } } });

const splitDoc = JSON.stringify(fx('v-rising.json'));
const cards = [
  { id: 'A', name: 'Rust', desc: desc(rust), actions: [move(ME, '2026-09-01')] },
  { id: 'B', name: 'Enshrouded (other member)', desc: desc(fx('enshrouded.json')), actions: [move(OTHER, '2026-09-01')] },
  { id: 'C', name: 'Enshrouded (via app)', desc: desc(fx('enshrouded.json')), actions: [move(ME, '2026-09-01', { id: 'mcp-app' })] },
  { id: 'D', name: 'Enshrouded (hallucinated)', desc: desc(fx('bad-hallucinated.json')), actions: [move(ME, '2026-09-01')] },
  { id: 'E', name: 'Enshrouded (edited after approval)', desc: desc(fx('enshrouded.json')), actions: [move(ME, '2026-09-01'), edit(OTHER, '2026-09-02')] },
  { id: 'F', name: 'Rust duplicate', desc: desc(rust), actions: [move(ME, '2026-09-01')] },
  { id: 'G', name: 'No JSON', desc: 'forgot the json', actions: [move(ME, '2026-09-01')] },
  { id: 'H', name: 'Split across comment', desc: 'part 1\n\n```json\n' + splitDoc.slice(0, 120) + '\n```', actions: [move(ME, '2026-09-01')],
    comments: ['Human summary: V Rising has announce only, no kick/ban over RCON.', 'part 2\n\n```json\n' + splitDoc.slice(120) + '\n```'] },
];

let tokenSeen = true;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.searchParams.get('token') !== 'tok' || u.searchParams.get('key') !== 'key') tokenSeen = false;
  let m;
  if ((m = u.pathname.match(/^\/1\/lists\/([^/]+)\/cards$/)) && m[1] === LIST) {
    return res.end(JSON.stringify(cards.map(({ id, name, desc }) => ({ id, name, desc, shortUrl: `https://trello.com/c/${id}` }))));
  }
  if ((m = u.pathname.match(/^\/1\/cards\/([^/]+)\/actions$/))) {
    const card = cards.find((c) => c.id === m[1]);
    if (u.searchParams.get('filter') === 'commentCard') {
      return res.end(JSON.stringify((card.comments ?? []).map((text, i) => ({ type: 'commentCard', date: `2026-09-0${i + 1}`, data: { text } }))));
    }
    return res.end(JSON.stringify(card.actions));
  }
  res.statusCode = 404; res.end('nope');
});
await new Promise((r) => server.listen(0, r));
const API = `http://127.0.0.1:${server.address().port}/1`;

async function run(dir, extra = {}) {
  const out = join(dir, 'gh_output');
  writeFileSync(out, '');
  let stdout;
  try {
    ({ stdout } = await execFileP('node', [script], { cwd: dir, encoding: 'utf8', timeout: 20000, env: {
      PATH: process.env.PATH, SCHEMA_PATH: SCHEMA, NODE_PATH: join(here, '..', 'node_modules'), NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', TRELLO_API: API, TRELLO_KEY: 'key', TRELLO_TOKEN: 'tok',
      TRELLO_APPROVED_LIST_ID: LIST, TRELLO_APPROVER_ID: ME, GITHUB_OUTPUT: out, ...extra } }));
  } catch (e) { console.error(e.stdout, e.stderr); throw e; }
  const o = Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('=')));
  return { stdout, o };
}
const status = (stdout, name) => stdout.split('\n').find((l) => l.includes(`[${name}]`))?.split('|')[2]?.trim();

// Run 1: default policy
const dir = mkdtempSync(join(tmpdir(), 'pub-'));
let { stdout, o } = await run(dir);
console.log(stdout);
assert.equal(status(stdout, 'Rust'), 'added');
assert.equal(status(stdout, 'Enshrouded (other member)'), 'invalid');
assert.equal(status(stdout, 'Enshrouded (via app)'), 'invalid');
assert.equal(status(stdout, 'Enshrouded (hallucinated)'), 'invalid');
assert.equal(status(stdout, 'Enshrouded (edited after approval)'), 'invalid');
assert.equal(status(stdout, 'Rust duplicate'), 'invalid');
assert.ok(stdout.includes('duplicate slug "rust"'));
assert.equal(status(stdout, 'No JSON'), 'invalid');
assert.equal(status(stdout, 'Split across comment'), 'added');
assert.equal(o.changed, '2'); assert.equal(o.invalid, '6'); assert.equal(o.ids, 'rust, v-rising');
assert.deepEqual(readdirSync(join(dir, 'commands')).sort(), ['index.json', 'rust.json', 'v-rising.json']);
const idxRaw = JSON.parse(readFileSync(join(dir, 'commands', 'index.json'), 'utf8'));
assert.equal(idxRaw.games[0].slug, 'rust');
assert.equal(idxRaw.games[0].displayName, 'Rust Dedicated Server');
assert.equal(idxRaw.games[0].verified, false);
assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(idxRaw.generatedAt));
assert.equal(readFileSync(join(dir, 'commands', 'rust.json'), 'utf8'), JSON.stringify(rust, null, 2) + '\n');
const genAt = idxRaw.generatedAt;

// Run 2: idempotent, and index.json does not churn
({ stdout, o } = await run(dir));
assert.equal(status(stdout, 'Rust'), 'unchanged'); assert.equal(o.changed, '0');
assert.equal(JSON.parse(readFileSync(join(dir, 'commands', 'index.json'), 'utf8')).generatedAt, genAt);

// Run 3: app moves allowed -> V Rising accepted
({ stdout, o } = await run(dir, { ALLOW_APP_MOVES: 'true' }));
assert.equal(status(stdout, 'Enshrouded (via app)'), 'added');
assert.ok(existsSync(join(dir, 'commands', 'enshrouded.json')));

// Run 4: dry run writes nothing
const dry = mkdtempSync(join(tmpdir(), 'dry-'));
({ stdout, o } = await run(dry, { DRY_RUN: 'true' }));
assert.equal(status(stdout, 'Rust'), 'added'); assert.ok(!existsSync(join(dry, 'commands')));

assert.ok(tokenSeen, 'key/token sent on every request');
server.close();
console.log('\nALL TESTS PASSED');
