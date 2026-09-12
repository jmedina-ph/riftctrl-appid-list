// Validates commands/<slug>.json against commands/schema.json (draft-07) plus the rules the
// schema cannot express: placeholder whitelists per field, no control characters, slug == filename,
// regexes that compile, playerParse present when listPlayers is.
//
// CLI:    node scripts/validate-commands.mjs commands/rust.json [...]
// Module: import { makeValidator } from './validate-commands.mjs'
//         const check = await makeValidator();  check(doc, 'rust') -> string[] of errors
// Needs:  npm install --no-save ajv@8 ajv-formats@3

import { readFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = process.env.SCHEMA_PATH || join(HERE, '..', 'commands', 'schema.json');
const MAX_BYTES = Number(process.env.MAX_FILE_BYTES || 16384);

// Per the commands/README: only these placeholders exist, and each field may use only some of them.
const ALLOWED_TOKENS = {
  info: [],
  listPlayers: [],
  kick: ['playerId', 'playerName', 'reason'],
  ban: ['playerId', 'playerName', 'reason', 'duration'],
  unban: ['playerId'],
  say: ['message'],
  motd: ['message'],
};

const tryRegex = (src, label, errors) => {
  try { return new RegExp(src); } catch (e) { errors.push(`${label} is not a valid regex: ${e.message}`); return null; }
};

export async function makeValidator(schemaPath = SCHEMA_PATH) {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);

  return function check(doc, expectedSlug) {
    const errors = [];
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return ['document must be a JSON object'];
    if (Buffer.byteLength(JSON.stringify(doc)) > MAX_BYTES) errors.push(`document exceeds ${MAX_BYTES} bytes`);

    if (!validateSchema(doc)) {
      for (const e of validateSchema.errors) errors.push(`${e.instancePath || '/'} ${e.message}`.trim());
    }

    if (expectedSlug !== undefined && doc.slug !== expectedSlug) {
      errors.push(`slug "${doc.slug}" must equal the filename "${expectedSlug}"`);
    }

    for (const [field, cmd] of Object.entries(doc.commands ?? {})) {
      if (typeof cmd !== 'string') continue;
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x1f\x7f]/.test(cmd)) errors.push(`commands.${field} contains control characters (a newline here chains a second command)`);
      const allowed = ALLOWED_TOKENS[field] ?? [];
      for (const m of cmd.matchAll(/\{([A-Za-z]+)\}/g)) {
        if (!allowed.includes(m[1])) {
          errors.push(`commands.${field} uses {${m[1]}}; allowed here: ${allowed.length ? allowed.map((t) => `{${t}}`).join(', ') : 'no placeholders'}`);
        }
      }
    }

    if (doc.commands?.listPlayers && !doc.playerParse) errors.push('commands.listPlayers is set, so playerParse is required');
    if (doc.playerParse && !doc.commands?.listPlayers) errors.push('playerParse is set but commands.listPlayers is missing');
    if (doc.commands && Object.keys(doc.commands).length > 0 && !doc.playerId) errors.push('commands are present, so playerId is required (wrong id = kick/ban hits nobody)');

    if (doc.playerId?.pattern) {
      const re = tryRegex(doc.playerId.pattern, 'playerId.pattern', errors);
      if (re && doc.playerId.example !== undefined && !re.test(doc.playerId.example)) {
        errors.push(`playerId.example "${doc.playerId.example}" does not match playerId.pattern`);
      }
    }
    if (doc.playerParse?.mode === 'regex' && doc.playerParse.linePattern) {
      const re = tryRegex(doc.playerParse.linePattern, 'playerParse.linePattern', errors);
      if (re) {
        for (const g of ['name', 'playerId']) {
          if (!doc.playerParse.linePattern.includes(`(?<${g}>`)) errors.push(`playerParse.linePattern must contain a named group (?<${g}>…)`);
        }
      }
      if (doc.playerParse.skipLinePattern) tryRegex(doc.playerParse.skipLinePattern, 'playerParse.skipLinePattern', errors);
    }
    if (doc.banList?.lineIdPattern) {
      const re = tryRegex(doc.banList.lineIdPattern, 'banList.lineIdPattern', errors);
      if (re) {
        const groups = new RegExp(doc.banList.lineIdPattern + '|').exec('').length - 1;
        if (groups !== 1) errors.push(`banList.lineIdPattern must have exactly one capture group (found ${groups})`);
      }
    }
    return errors;
  };
}

// CLI
const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = await makeValidator();
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    let errs;
    try { errs = check(JSON.parse(readFileSync(f, 'utf8')), basename(f, '.json')); }
    catch (e) { errs = [`invalid JSON: ${e.message}`]; }
    if (errs.length) { bad++; console.log(`✗ ${f}\n  - ${errs.join('\n  - ')}`); } else console.log(`✓ ${f}`);
  }
  process.exit(bad ? 1 : 0);
}
