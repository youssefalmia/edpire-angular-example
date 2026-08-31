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
 * Deliberately opaque: your app never constructs or reads these, it only
 * collects them from `onAnswersChange` and hands them straight back to Edpire.
 * The concrete variants (choice sets, typed blanks, matching pairs, open
 * responses) are exported from the npm package if you ever need to inspect one.
 */
export type EdpireRuntimeAnswer = Record<string, unknown>

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
}

export interface GradeResult {
  submission_id: string
  score: number
  max_score: number
  percentage: number
  passed: boolean
  awaiting_manual_grading: boolean
}
