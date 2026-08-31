/**
 * TypeScript declarations for the Edpire CDN bundle.
 *
 * The bundle is loaded with a script tag, so it arrives as an untyped global.
 * These declarations are the only thing standing between that and `any`, which
 * `strict: true` will not let you get away with anyway. They are hand-written
 * against @edpire/sdk 0.6.12 and cover exactly the four exports the bundle
 * publishes.
 *
 * You do not need to install @edpire/sdk to use these. If you would rather have
 * the types come from the package itself, `npm i -D @edpire/sdk` and import
 * from "@edpire/sdk" instead -- but that pulls React's type packages into your
 * project for no runtime benefit, which is why this file exists.
 */

/**
 * A learner's answer to one node of a question.
 *
 * You never construct these -- you collect them from `onAnswersChange` and hand
 * them straight back to Edpire. They are typed as a discriminated union rather
 * than an opaque record for one reason: you cannot tell whether a learner has
 * actually answered without looking inside. Every player emits an answer as
 * soon as it mounts, so a non-empty array means "a question is on screen", not
 * "the learner did something". See `isAnswered()` in edpire-answers.ts.
 *
 * Mirrors RuntimeAnswer in @youssefalmia/edpire-schema.
 */
export interface EdpireAnswerBase {
  nodeId: string
  timestamp: number
}

export interface EdpireChoiceSetAnswer extends EdpireAnswerBase {
  type: 'choiceSet' | 'inlineChoiceSet'
  answer: { selectedIds: string[] }
}

/** A blank filled by dragging a word from a pool. */
export interface EdpireBlankChoiceAnswer extends EdpireAnswerBase {
  type: 'blank'
  answer: { mode: 'choice'; choiceId: string; poolId: string; value: string }
}

/** A blank the learner types into. Emits `text: ""` on mount. */
export interface EdpireTypedBlankAnswer extends EdpireAnswerBase {
  type: 'blank'
  answer: { mode: 'typed'; text: string }
}

export interface EdpireMatchingSetAnswer extends EdpireAnswerBase {
  type: 'matchingSet'
  answer: { connections: Array<{ leftId: string; rightId: string }> }
}

export interface EdpireAiAnswer extends EdpireAnswerBase {
  type: 'aiAnswer'
  answer: { text: string; wordCount: number }
}

/** Text, file upload, audio or video recording -- or text plus a file. */
export interface EdpireOpenResponseAnswer extends EdpireAnswerBase {
  type: 'openResponse'
  answer: {
    text?: { content: unknown[]; wordCount: number }
    files?: Array<{ url: string; mimeType: string; name?: string; duration?: number }>
    recording?: { url: string; mimeType: string; duration: number; kind: 'audio' | 'video' }
  }
}

export interface EdpireMathResponseAnswer extends EdpireAnswerBase {
  type: 'mathResponse'
  answer: { latex: string }
}

export interface EdpireCodingAnswer extends EdpireAnswerBase {
  type: 'codingResponse'
  answer: { language: string; source: string; testResults: unknown[] }
}

export type EdpireRuntimeAnswer =
  | EdpireChoiceSetAnswer
  | EdpireBlankChoiceAnswer
  | EdpireTypedBlankAnswer
  | EdpireMatchingSetAnswer
  | EdpireAiAnswer
  | EdpireOpenResponseAnswer
  | EdpireMathResponseAnswer
  | EdpireCodingAnswer

/** Every way an embed can fail before or during an attempt. */
export type EdpireErrorCode =
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_USED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'ASSESSMENT_NOT_FOUND'
  | 'MAX_ATTEMPTS_REACHED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN'

export interface EdpireEmbedError {
  code: EdpireErrorCode
  message: string
}

/** What `onComplete` hands you when the learner submits. */
export interface EdpireEmbedResult {
  submission_id: string
  score: number
  max_score: number
  percentage: number
  passed: boolean
  passing_score_percent: number
  attempt_number: number
  /**
   * True when the attempt contains open-response questions a teacher has yet to
   * mark. `score` and `passed` are then PROVISIONAL -- they cover only the
   * auto-graded questions. Do not store them as a final grade; wait for the
   * `submission.grading.completed` webhook.
   */
  awaiting_manual_grading?: boolean
  exercise_results: Array<{
    exercise_id: string
    total_score: number
    max_score: number
    question_results: Array<{
      question_id: string
      score: number
      correct: boolean
      points: number
    }>
  }>
}

export interface EdpireMountOptions {
  /** The short-lived token your server minted. Never an API key. */
  token: string
  /** CSS selector or element. Must have a real height or the player collapses. */
  container: string | HTMLElement
  /** Defaults to https://edpire.com. */
  baseUrl?: string
  /** Player UI language. RTL layout applies automatically for "ar". */
  locale?: 'en' | 'fr' | 'ar'
  /** White-label overrides. Org branding loads automatically without this. */
  branding?: Record<string, unknown>
  /** Shows a "view report" button that navigates here with ?submission_id= appended. */
  returnUrl?: string
  reportLabel?: string
  /** Renders a back button, shown only before submission. */
  onBack?: () => void
  backLabel?: string
  overlayConfig?: Record<string, unknown>
  /** REQUIRED if any question asks for a file upload or an audio/video recording. */
  mediaHandler?: unknown
  onComplete?: (result: EdpireEmbedResult) => void
  onError?: (error: EdpireEmbedError) => void
}

export interface EdpireEmbedInstance {
  unmount(): void
}

/** One question, lifted out of the assessment tree into a linear sequence. */
export interface EdpireFlatStep {
  /** Required by /check, alongside questionId. */
  exerciseId: string
  questionId: string
  /** The ContentAST. Pass straight to renderQuestion; never parse it yourself. */
  content: unknown
  points: number
  sequenceNumber: number
  /** 0-based position in the flattened sequence. Use it for a progress bar. */
  index: number
}

export interface EdpireRenderQuestionOptions {
  container: string | HTMLElement
  content: unknown
  onAnswersChange?: (answers: EdpireRuntimeAnswer[]) => void
  /** The `feedback` field from /check, passed through unmodified. */
  feedback?: Record<string, unknown> | null
  initialAnswers?: EdpireRuntimeAnswer[]
  dir?: 'ltr' | 'rtl'
}

export interface EdpireQuestionInstance {
  /** Swap in the next question. Also clears feedback. */
  setContent(content: unknown): void
  /** Pass /check's `feedback` to reveal marking; null clears it. */
  setFeedback(feedback: Record<string, unknown> | null): void
  setInitialAnswers(answers: EdpireRuntimeAnswer[]): void
  unmount(): void
}

/** What one question's answers look like on their way to /submit. */
export interface EdpireStoredAnswer {
  exerciseId: string
  questionId: string
  answers: EdpireRuntimeAnswer[]
}

/** The shape of `window.EdpireSDK` once the CDN bundle has loaded. */
export interface EdpireSdk {
  EdpireAssessment: {
    mount(options: EdpireMountOptions): EdpireEmbedInstance
  }
  renderQuestion(options: EdpireRenderQuestionOptions): EdpireQuestionInstance
  flattenAssessment(assessment: unknown): EdpireFlatStep[]
  buildSubmitPayload(stored: EdpireStoredAnswer[]): unknown
}

declare global {
  interface Window {
    EdpireSDK?: EdpireSdk
  }
}

// -- Your own backend's response shapes --------------------------------------

/**
 * The assessment as your backend relays it, trimmed to what this app reads.
 *
 * `shared_context` is the reason this type exists at all: `flattenAssessment()`
 * returns questions only, so an exercise's reading passage, figure or worked
 * example is not in the steps. Rendering questions without it makes a
 * comprehension exercise unanswerable, so the Arcade screen keeps the original
 * assessment around and looks the context up by exercise ID.
 */
export interface AssessmentPayload {
  id: string
  title: string
  exercises: Array<{
    id: string
    shared_context: unknown | null
    questions: Array<{ id: string; content_ast: unknown; points: number; sequence_number: number }>
  }>
}

export interface AssessmentListItem {
  id: string
  title: string
  exerciseCount: number | null
}

export interface CheckResult {
  correct: boolean
  score: number
  max_score: number
  /** Keyed by node ID. Hand it to setFeedback() as-is. */
  feedback: Record<string, unknown>
  /** Not from the API: set locally when a check could not be completed. */
  message?: string
}

export interface GradeResult {
  submission_id: string
  score: number
  max_score: number
  percentage: number
  passed: boolean
  awaiting_manual_grading: boolean
}
