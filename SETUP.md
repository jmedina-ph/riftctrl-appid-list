# Trello → GitHub publishing setup (jmedina-ph/riftctrl-codex)

```
Cowork (monthly)              Trello "RIFT//CTRL Commands"                GitHub Action (30 */3 * * *)
research + propose ─cards──▶  Proposed / Needs Info ─(you drag)─▶ Approved ──read-only──▶ validate ─▶ commit commands/<slug>.json
```

Cowork never holds GitHub credentials. The Action's Trello token is read-only. The only thing that can
write to the repo is GitHub's own `GITHUB_TOKEN`, inside the repo.

## Step 1 — add these files to the repo (branch `main`)

| File | Note |
|---|---|
| `.github/workflows/publish-approved-commands.yml` | cron `30 */3 * * *`, offset from `publish-applist.yml`; stages `commands/` only; rebase-and-retry on a rejected push |
| `scripts/publish-approved.mjs` | reads Trello, checks approval, writes files |
| `scripts/validate-commands.mjs` | validates against `commands/schema.json` plus the rules the schema can't express |
| `commands/rust.json` | optional first real file (researched 2026-09-10, `verifiedAt: null`) |
| `test/` | optional; `node test/publish.test.mjs` runs the whole flow against a mock Trello |

`commands/schema.json` in the zip is a byte-for-byte copy of what's already in the repo. Don't overwrite it.
The workflow installs ajv itself (`npm install --no-save ajv@8 ajv-formats@3`), so `package.json` is untouched.

## Step 2 — Trello API key

Go to https://trello.com/power-ups/admin → **New** → create an integration (name it `riftctrl-codex`).
Open it and copy the **API key**.

## Step 3 — read-only Trello token

Open this with your key pasted in, and click **Allow**:

```
https://trello.com/1/authorize?expiration=1year&scope=read&response_type=token&name=riftctrl-codex&key=YOUR_KEY
```

`scope=read` means this token cannot change anything in Trello, even if the repo leaks it.
Copy the token from the page.

## Step 4 — repo secrets and variables

Repo → Settings → Secrets and variables → Actions.

| Tab | Name | Value |
|---|---|---|
| Secrets | `TRELLO_KEY` | key from step 2 |
| Secrets | `TRELLO_TOKEN` | token from step 3 |
| Variables | `TRELLO_APPROVED_LIST_ID` | `6aa3971dc6c78512af33a184` |
| Variables | `TRELLO_APPROVER_ID` | `6a7960e27e2cca2c06a3bdd0` |

If `main` is protected against direct pushes, allow GitHub Actions to push, or the commit step fails.

## Step 5 — acceptance test

The board has two cards whose JSON is deliberately invalid, so neither can ever be published.

1. Drag **ACCEPTANCE TEST 2** to **Approved** yourself in Trello. (Claude already put **TEST 1** there
   through the connector.)
2. Actions → *Publish approved commands* → **Run workflow** (dry run is on by default).
3. Read the job summary:

| Card | Says | Meaning |
|---|---|---|
| TEST 1 | "moved … through an app/integration" | ✅ Trello marks connector moves. Claude cannot approve for you. |
| TEST 1 | "schemaVersion … must be equal to constant" or similar schema error | ⚠️ Connector moves look identical to yours; the only barrier is the task's instruction never to touch Approved. Tell Claude. |
| TEST 2 | a schema error | ✅ Your manual approvals are recognised. |
| TEST 2 | "moved … through an app/integration" | Trello marks your own client's moves too. Set variable `ALLOW_APP_MOVES=true`, which also drops the TEST 1 protection. |

4. Archive both test cards.

## Day to day

- Cards arrive monthly in **Proposed** (two or more sources agree) or **Needs Info** (one source, or
  sources disagree). The description holds the JSON; a comment explains the evidence.
- **Approve** by dragging to Approved. It publishes within ~3 hours. Edit the JSON *before* dragging:
  an edit after approval invalidates it, and you drag the card out and back in to re-approve.
- **Reject** by dragging to Rejected. That game won't be proposed again.
- A rejected card left in Approved turns every run red and emails you. Move it out.
- The monthly task moves published cards to **Published**.

## Big files: multi-part cards

Through the connector a description holds ~2,048 characters (`rust.json` is 1,931). Larger games are split:
part 1 in the description, the rest in `​```json` comments, oldest first. The script concatenates every
json fence it finds — description, then comments in order — and parses the result as one document.
A comment without a json fence is ignored, which is how the human-readable summary sits on the same card.

## What the Action enforces before committing

- The last move into Approved was by `TRELLO_APPROVER_ID`, by hand, not through an integration.
- Nothing changed on the card after approval except by you, by hand.
- The document validates against `commands/schema.json`, plus:
  - `slug` equals the filename;
  - commands contain no control characters (a newline would chain a second command);
  - only the placeholders each field allows — `{playerId}`, `{playerName}`, `{reason}`, `{duration}`, `{message}`;
  - `commands.listPlayers` requires `playerParse`, and any commands require `playerId`;
  - `playerId.pattern`, `playerParse.linePattern` and `banList.lineIdPattern` compile, `playerId.example`
    matches its own pattern, `lineIdPattern` has exactly one capture group;
  - 16 KB per file.
- No two cards claim the same slug.
- `index.json` is regenerated from the files on disk, and keeps its old `generatedAt` when no row changed.
