/**
 * The Edpire half of your backend, in one file.
 *
 * It exists because your API key must never reach the browser. An Angular
 * bundle is a text file anyone can read, so a key shipped in it is a public
 * key. Everything that needs the key happens here; the browser gets only
 * short-lived tokens and answer-free question content.
 *
 * In your real product this is not a separate service. It is four routes inside
 * the backend you already have, sitting next to the session they read the
 * learner from.
 *
 *   node --env-file=.env server.mjs
 *
 * -- The routes --------------------------------------------------------------
 *
 *   GET  /api/edpire/assessments              the picker list (titles + IDs)
 *   POST /api/edpire/token                    Exam Hall: { assessmentId } -> { token }
 *   GET  /api/edpire/assessments/:id          Arcade: content, no answer keys
 *   POST /api/edpire/assessments/:id/check    Arcade: grade one question
 *   POST /api/edpire/assessments/:id/submit   Arcade: record the whole attempt
 *
 * The first two are all Exam Hall needs. The last three exist only because
 * Arcade draws its own screen and therefore needs the content and a way to
 * grade it. If you only ship Exam Hall, delete them.
 */
import { createServer } from "node:http"
import { createEdpireTokenHandler, toNodeHandler, EdpireClient } from "@edpire/sdk/client"

const PORT = Number(process.env.PORT ?? 8787)
const API_KEY = process.env.EDPIRE_API_KEY
const BASE_URL = process.env.EDPIRE_BASE_URL ?? "https://edpire.com"

/** How many assessments the picker shows. Yours would paginate. */
const PICKER_LIMIT = 10

if (!API_KEY) {
  console.error("EDPIRE_API_KEY is not set. Copy .env.example to .env and fill it in.")
  process.exit(1)
}

const client = new EdpireClient({ apiKey: API_KEY, baseUrl: BASE_URL })

/**
 * ---------------------------------------------------------------------------
 * THIS IS THE ONE FUNCTION YOU MUST REPLACE.
 * ---------------------------------------------------------------------------
 *
 * It answers "which learner is this request for?", and its answer decides whose
 * results get recorded. The example hardcodes a demo learner so the app runs
 * with no auth set up.
 *
 * In production, read it from YOUR session:
 *
 *   async function resolveLearner(req) {
 *     const session = await auth.getSession(req.headers)
 *     return session?.user.id ?? null       // null -> 401
 *   }
 *
 * Never read the learner ID from the request body. If you do, any learner can
 * submit results as any other by editing one JSON field.
 *
 * The value you return is the `learner_ref`: your own user ID, in whatever
 * shape it already has. You do not create it in Edpire first. The first
 * submission carrying a given ref is what makes that learner exist in results.
 */
function resolveLearner(_req) {
  return "demo-learner-001"
}

/** The published assessments this org can offer. IDs and titles are not secret. */
async function listPublished() {
  const { items } = await client.getAssessments({ status: "published", limit: PICKER_LIMIT })
  return (items ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    exerciseCount: a.exercise_count ?? null,
  }))
}

// -- Exam Hall: the token endpoint -------------------------------------------
// createEdpireTokenHandler is a Web-standard handler; toNodeHandler adapts it to
// a plain Node request. On Express, Fastify or NestJS the same two functions
// work unchanged -- mount the result BEFORE any body parser, because the
// handler reads the request stream itself and a parser that already drained it
// makes this hang.
const tokenHandler = toNodeHandler(
  createEdpireTokenHandler({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    resolveLearner: (req) => resolveLearner(req),
    /**
     * Optional, omitted here only because this example publishes everything in
     * the org. In a real app, check entitlement HERE, not only on the screen
     * that opens the player. This endpoint is reachable on its own, so a check
     * on the page is UX and this one is the boundary.
     *
     *   resolveAssessmentId: async (req, requestedId) => {
     *     const lesson = await db.lesson.findByEdpireId(requestedId)
     *     if (!lesson || !(await learnerCanAccess(req, lesson))) throw new Error("Not entitled")
     *     return requestedId
     *   },
     */
  }),
)

// -- Plumbing ----------------------------------------------------------------

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error("Request body must be JSON"))
      }
    })
    req.on("error", reject)
  })
}

/** Turn an EdpireError (or anything else) into a status the browser can act on. */
function explain(err) {
  const status = typeof err?.status === "number" ? err.status : 502
  return {
    status: status === 404 || status === 429 ? status : 502,
    message: err?.message ?? "Edpire request failed",
  }
}

const server = createServer(async (req, res) => {
  // The Angular dev server proxies /api to this process (see app/proxy.conf.json),
  // so the browser sees a single origin and there is no CORS in development.
  // These headers matter only if you bypass the proxy and call this port direct.
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  if (req.method === "OPTIONS") return res.writeHead(204).end()

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`)
  const path = url.pathname

  if (req.method === "GET" && path === "/health") {
    return json(res, 200, { ok: true })
  }

  // -- The picker list -------------------------------------------------------
  if (req.method === "GET" && path === "/api/edpire/assessments") {
    try {
      return json(res, 200, { assessments: await listPublished() })
    } catch (err) {
      console.error("Could not list assessments:", err.message)
      return json(res, 502, { error: "Could not reach Edpire. Check EDPIRE_API_KEY." })
    }
  }

  // -- Exam Hall: mint a token -----------------------------------------------
  if (req.method === "POST" && path === "/api/edpire/token") {
    return tokenHandler(req, res)
  }

  // -- Arcade: the assessment content ----------------------------------------
  // Answer keys are never in this response. The API strips them server-side, so
  // handing the whole thing to the browser is safe by construction.
  const contentMatch = path.match(/^\/api\/edpire\/assessments\/([^/]+)$/)
  if (req.method === "GET" && contentMatch) {
    try {
      // Entitlement belongs here too -- this route is reachable on its own.
      return json(res, 200, { assessment: await client.getAssessment(contentMatch[1]) })
    } catch (err) {
      const { status, message } = explain(err)
      return json(res, status, { error: message })
    }
  }

  // -- Arcade: grade one question --------------------------------------------
  // Stateless: nothing is recorded. `include_correct_answers` is set HERE and
  // never read from the browser, because it decides whether the response
  // reveals the answer. Letting the client ask for it hands every learner the
  // key.
  const checkMatch = path.match(/^\/api\/edpire\/assessments\/([^/]+)\/check$/)
  if (req.method === "POST" && checkMatch) {
    try {
      const body = await readJsonBody(req)
      const result = await client.checkQuestion(checkMatch[1], {
        exercise_id: body.exercise_id,
        question_id: body.question_id,
        answers: body.answers ?? [],
        session_id: body.session_id,
        learner_ref: resolveLearner(req), // from the session, not the body
        include_correct_answers: true,
      })
      return json(res, 200, result)
    } catch (err) {
      const { status, message } = explain(err)
      // 429 is the per-question check limit: 3 per question, per session, per
      // rolling hour. It is a brute-force guard, not a bug. Reveal the answer
      // and move on rather than retrying.
      return json(res, status, { error: message })
    }
  }

  // -- Arcade: record the whole attempt --------------------------------------
  // /check records nothing, so without this call the attempt never happened.
  // One call at the end creates the graded submission and fires the
  // `submission.graded` webhook.
  const submitMatch = path.match(/^\/api\/edpire\/assessments\/([^/]+)\/submit$/)
  if (req.method === "POST" && submitMatch) {
    try {
      const body = await readJsonBody(req)
      const result = await client.submit(submitMatch[1], {
        learner_ref: resolveLearner(req), // from the session, not the body
        answers: body.answers ?? [], // flat StoredAnswer[]; the client converts it
      })
      return json(res, 200, result)
    } catch (err) {
      const { status, message } = explain(err)
      return json(res, status, { error: message })
    }
  }

  json(res, 404, { error: "Not found" })
})

server.listen(PORT, async () => {
  console.log(`\nEdpire example server on http://localhost:${PORT}`)
  console.log("  GET  /api/edpire/assessments              the picker list")
  console.log("  POST /api/edpire/token                    Exam Hall")
  console.log("  GET  /api/edpire/assessments/:id          Arcade content")
  console.log("  POST /api/edpire/assessments/:id/check    Arcade per-question")
  console.log("  POST /api/edpire/assessments/:id/submit   Arcade final\n")

  // Print what the app will offer, so you see straight away whether your API key
  // works and whether there is anything published to play.
  try {
    const assessments = await listPublished()
    if (assessments.length === 0) {
      console.log("No published assessments in this organisation yet.")
      console.log("Create one at https://edpire.com, publish it, then restart this server.")
      console.log("Guide: https://docs.edpire.com/quickstart\n")
    } else {
      console.log(`Published assessments (showing up to ${PICKER_LIMIT}):`)
      for (const a of assessments) console.log(`  ${a.id}  ${a.title}`)
      console.log("\nThe app lists these for you. You do not need to copy an ID by hand.\n")
    }
  } catch (err) {
    console.error(`Could not reach Edpire at ${BASE_URL}: ${err.message}`)
    console.error("Check EDPIRE_API_KEY in .env.\n")
  }
})
