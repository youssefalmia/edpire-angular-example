/**
 * Attempts: keeping your copy in step with Edpire, and turning it into cards.
 *
 * There is exactly one function that writes an attempt, `recordAttempt`, and
 * three things call it:
 *
 *   1. The browser, the moment the player finishes    -> fast: the card is right
 *                                                          when the learner goes back
 *   2. The `submission.graded` / `.grading.completed`  -> reliable: covers a closed
 *      webhooks                                            tab, and a teacher's marks
 *   3. A backfill from GET /learners/{ref}/results      -> repair: attempts made
 *                                                          before this code shipped
 *
 * None of them trusts what it was told. Each hands recordAttempt a submission ID
 * and recordAttempt asks Edpire for the facts with the API key. So a learner who
 * edits the request the browser sends can at most make you re-read their own
 * real result.
 */
import { listAttempts, upsertAttempt } from "./attempts-store.mjs"

/**
 * Fetch one attempt from Edpire and store it.
 *
 * `expectedLearner`, when given, must own the submission. The browser path
 * passes the session's learner, so nobody can claim someone else's attempt as
 * their own by posting its ID. The webhook path passes nothing, because the
 * payload is signed and the learner comes from Edpire itself.
 */
export async function recordAttempt(client, submissionId, expectedLearner) {
  const s = await client.getSubmission(submissionId)

  if (expectedLearner && s.learner_ref !== expectedLearner) {
    const err = new Error("Submission not found")
    err.status = 404
    throw err
  }
  // Started but never handed in: nothing to show on a card yet.
  if (!s.submitted_at) return null

  const row = toRow(s)
  upsertAttempt(row)
  return row
}

/**
 * Pull every attempt Edpire already holds for this learner. Run it once per
 * learner, e.g. on sign-in, or as a one-off script for your existing users on
 * the day this feature ships. Webhooks keep it current from then on.
 */
export async function backfillLearner(client, learnerRef) {
  let page = 1
  for (;;) {
    const { items, total } = await client.getLearnerResults(learnerRef, { page, limit: 100 })
    for (const s of items ?? []) if (s.submitted_at) upsertAttempt(toRow(s))
    if (!items?.length || page * 100 >= total) break
    page += 1
  }
}

/** Backfill each learner once per server process. Your version: once, ever. */
const backfilled = new Set()
export async function ensureBackfilled(client, learnerRef) {
  if (backfilled.has(learnerRef)) return
  backfilled.add(learnerRef)
  try {
    await backfillLearner(client, learnerRef)
  } catch (err) {
    // A failed backfill is not fatal: cards fall back to whatever is stored.
    backfilled.delete(learnerRef)
    console.error("Backfill failed:", err.message)
  }
}

function toRow(s) {
  return {
    submission_id: s.id,
    user_id: s.learner_ref,
    assessment_id: s.assessment_id,
    attempt_number: s.attempt_number,
    score: s.score,
    max_score: s.max_score,
    percentage: s.percentage,
    passed: s.passed ?? null,
    is_fully_graded: s.is_fully_graded,
    submitted_at: s.submitted_at,
  }
}

/**
 * The state of one catalogue card. This is the whole "finished / retry /
 * review" feature, and it is ordinary code over your own table.
 *
 *   new        never attempted                    -> Start
 *   grading    latest attempt awaits a teacher    -> Review (score withheld)
 *   done       latest attempt fully marked        -> Review, Retry
 *
 * `canRetry` is separate from the state because attempt limits are an
 * assessment setting: a finished assessment with none left is still "done",
 * it just loses its Retry button. Edpire enforces the limit regardless, so
 * this is only about not offering a button that would fail.
 */
export function cardFor(assessment, attempts) {
  const allowed = assessment.allowedAttempts // 0 = unlimited
  const used = attempts.length
  const attemptsLeft = allowed === 0 ? null : Math.max(0, allowed - used)

  const base = {
    id: assessment.id,
    title: assessment.title,
    category: assessment.category,
    maxScore: assessment.maxScore,
    attemptsUsed: used,
    attemptsLeft,
    canRetry: attemptsLeft !== 0,
  }

  if (used === 0) return { ...base, state: "new", latest: null, best: null }

  const latest = attempts[0] // listAttempts sorts newest first
  // "Best" only counts attempts whose score is final. A provisional score
  // from an attempt still awaiting a teacher would be a number you might
  // have to take back.
  const graded = attempts.filter((a) => a.is_fully_graded)
  const best = graded.length ? graded.reduce((b, a) => (a.percentage > b.percentage ? a : b)) : null

  return {
    ...base,
    state: latest.is_fully_graded ? "done" : "grading",
    latest: summary(latest),
    best: best ? summary(best) : null,
  }
}

function summary(a) {
  return {
    submissionId: a.submission_id,
    attemptNumber: a.attempt_number,
    score: a.score,
    maxScore: a.max_score,
    percentage: a.percentage,
    passed: a.passed,
    isFullyGraded: a.is_fully_graded,
    submittedAt: a.submitted_at,
  }
}

/** The attempt history behind one card, newest first. */
export function historyFor(learnerRef, assessmentId) {
  return listAttempts(learnerRef, assessmentId).map(summary)
}
