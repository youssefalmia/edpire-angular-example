/**
 * Your `edpire_attempts` table, standing in as a JSON file so the example runs
 * with no database.
 *
 * In production this is one table in the database you already have:
 *
 *   create table edpire_attempts (
 *     submission_id   uuid primary key,      -- Edpire's ID, and the idempotency key
 *     user_id         <your user PK> not null, -- what you send as learner_ref
 *     assessment_id   uuid not null,
 *     attempt_number  int not null,
 *     score           numeric not null,
 *     max_score       numeric not null,
 *     percentage      int not null,
 *     passed          boolean,
 *     is_fully_graded boolean not null,      -- false = a teacher still has to mark
 *     submitted_at    timestamptz not null,
 *     synced_at       timestamptz not null default now()
 *   );
 *   create index on edpire_attempts (user_id, assessment_id, submitted_at desc);
 *
 * One row per attempt, holding the numbers a catalogue card needs and nothing
 * else. It is a copy of Edpire's data, kept so that rendering a page of cards
 * costs you one indexed query instead of a call per card to someone else's API.
 *
 * What is deliberately NOT here: the questions, the learner's answers, the
 * corrections. Those are fetched from Edpire when a learner opens a review,
 * because they are large, only ever read one attempt at a time, and change
 * when a teacher re-marks. Copy them and you own keeping them in sync.
 *
 * Every write is an upsert keyed on submission_id, so writing the same attempt
 * twice (the browser and the webhook both report it; a webhook is redelivered)
 * is harmless by construction.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const FILE = join(dirname(fileURLToPath(import.meta.url)), "data", "attempts.json")

/** @type {Map<string, AttemptRow>} submission_id -> row */
const rows = new Map()

try {
  for (const row of JSON.parse(readFileSync(FILE, "utf8"))) rows.set(row.submission_id, row)
} catch {
  // First run: no file yet.
}

function persist() {
  mkdirSync(dirname(FILE), { recursive: true })
  // Write-then-rename, so a crash mid-write never leaves half a file.
  writeFileSync(`${FILE}.tmp`, JSON.stringify([...rows.values()], null, 2))
  renameSync(`${FILE}.tmp`, FILE)
}

/**
 * @typedef {object} AttemptRow
 * @property {string} submission_id
 * @property {string} user_id
 * @property {string} assessment_id
 * @property {number} attempt_number
 * @property {number} score
 * @property {number} max_score
 * @property {number} percentage
 * @property {boolean | null} passed
 * @property {boolean} is_fully_graded
 * @property {string} submitted_at
 * @property {string} synced_at
 */

/** INSERT ... ON CONFLICT (submission_id) DO UPDATE */
export function upsertAttempt(row) {
  rows.set(row.submission_id, { ...row, synced_at: new Date().toISOString() })
  persist()
}

/** SELECT * WHERE user_id = $1 [AND assessment_id = $2] ORDER BY submitted_at DESC */
export function listAttempts(userId, assessmentId) {
  return [...rows.values()]
    .filter((r) => r.user_id === userId && (!assessmentId || r.assessment_id === assessmentId))
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
}

/** SELECT 1 WHERE submission_id = $1 AND user_id = $2 */
export function ownsAttempt(userId, submissionId) {
  return rows.get(submissionId)?.user_id === userId
}
