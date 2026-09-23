import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { firstValueFrom } from 'rxjs'
import type {
  AssessmentListItem,
  AssessmentPayload,
  AttemptSummary,
  CheckResult,
  EdpireRuntimeAnswer,
  EdpireStoredAnswer,
  EdpireSubmissionReview,
  GradeResult,
  LibraryCard,
} from './edpire-sdk.types'

/**
 * Every call this app makes to YOUR backend.
 *
 * Note what is absent: an API key, and a learner ID. The key stays on your
 * server. The learner is decided by your server from its own session, which is
 * the only place it can be decided safely -- if the browser named the learner,
 * any learner could submit results as any other by editing one field.
 *
 * The paths are relative, so in development the Angular dev server proxies them
 * to the Node process on :8787 (see proxy.conf.json) and in production they are
 * just your own API. Either way the browser sees one origin and there is no
 * CORS to configure.
 */
@Injectable({ providedIn: 'root' })
export class EdpireApiService {
  private readonly http = inject(HttpClient)

  // -- My assessments ---------------------------------------------------------

  /** The cards. Each one already carries its state; the browser decides nothing. */
  library(): Promise<LibraryCard[]> {
    return firstValueFrom(this.http.get<{ cards: LibraryCard[] }>('/api/library')).then(
      (r) => r.cards,
    )
  }

  /** One card and the attempts behind it, newest first. */
  card(assessmentId: string): Promise<{ card: LibraryCard; attempts: AttemptSummary[] }> {
    return firstValueFrom(
      this.http.get<{ card: LibraryCard; attempts: AttemptSummary[] }>(
        `/api/library/${assessmentId}`,
      ),
    )
  }

  /**
   * "I just finished." Sends only the submission ID: your server reads the
   * score from Edpire and checks the attempt is this learner's, so there is
   * nothing here worth tampering with. It makes the card correct the instant
   * the learner goes back; the webhook would get there too, a little later.
   */
  recordAttempt(submissionId: string): Promise<void> {
    return firstValueFrom(
      this.http.post('/api/attempts', { submission_id: submissionId }),
    ).then(() => undefined)
  }

  /**
   * One past attempt, as the corrected paper. Hand the result to
   * EdpireAssessment.review() exactly as it arrives.
   */
  review(submissionId: string): Promise<EdpireSubmissionReview> {
    return firstValueFrom(
      this.http.get<EdpireSubmissionReview>(`/api/attempts/${submissionId}/review`),
    )
  }

  // -- Taking an assessment ---------------------------------------------------

  /** The mode picker list. Your product would read its own catalogue instead. */
  listAssessments(): Promise<AssessmentListItem[]> {
    return firstValueFrom(
      this.http.get<{ assessments: AssessmentListItem[] }>('/api/edpire/assessments'),
    ).then((r) => r.assessments)
  }

  /**
   * Exam Hall. Returns a token scoped to one learner and one assessment,
   * expiring in two hours. It is not a secret -- it is meant for the browser.
   */
  mintToken(assessmentId: string): Promise<string> {
    return firstValueFrom(
      this.http.post<{ token: string }>('/api/edpire/token', { assessmentId }),
    ).then((r) => r.token)
  }

  /** Arcade. The assessment content, with answer keys stripped server-side. */
  getAssessment(assessmentId: string): Promise<AssessmentPayload> {
    return firstValueFrom(
      this.http.get<{ assessment: AssessmentPayload }>(`/api/edpire/assessments/${assessmentId}`),
    ).then((r) => r.assessment)
  }

  /**
   * Arcade. Grades one question and returns feedback for it. Stateless: no
   * submission is created, so an abandoned attempt leaves no trace.
   *
   * `sessionId` must be the SAME uuid for every question in one attempt. Rate
   * limiting is keyed on it (3 checks per question, per session, per rolling
   * hour). Generate one per attempt; generate one per question and the limit
   * accumulates across retakes and surprises you with a 429.
   */
  checkQuestion(
    assessmentId: string,
    body: {
      exercise_id: string
      question_id: string
      answers: EdpireRuntimeAnswer[]
      session_id: string
    },
  ): Promise<CheckResult> {
    return firstValueFrom(
      this.http.post<CheckResult>(`/api/edpire/assessments/${assessmentId}/check`, body),
    )
  }

  /**
   * Arcade. Records and grades the whole attempt, once, at the end.
   *
   * Without this call the attempt never happened: /check writes nothing. This
   * is also what fires the `submission.graded` webhook.
   */
  submit(assessmentId: string, answers: EdpireStoredAnswer[]): Promise<GradeResult> {
    return firstValueFrom(
      this.http.post<GradeResult>(`/api/edpire/assessments/${assessmentId}/submit`, { answers }),
    )
  }
}
