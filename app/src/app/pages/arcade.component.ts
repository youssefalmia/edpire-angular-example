import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core'
import { RouterLink } from '@angular/router'
import { EdpireApiService } from '../edpire/edpire-api.service'
import { describeError } from '../edpire/edpire-error'
import { EdpireSdkService } from '../edpire/edpire-sdk.service'
import type {
  EdpireFlatStep,
  EdpireQuestionInstance,
  EdpireRuntimeAnswer,
  EdpireStoredAnswer,
  GradeResult,
} from '../edpire/edpire-sdk.types'

/**
 * Arcade mode: one question per screen, in whatever order you like.
 *
 * This is the answer to both "can I show each question on its own page?" and
 * "can I randomise the question order?". Neither is a setting you switch on in
 * Edpire -- both are consequences of drawing the screen yourself, which is what
 * this component does. Edpire supplies three things and nothing else:
 *
 *   flattenAssessment()  the questions as a flat, ordered array
 *   renderQuestion()     one question, rendered into a div you own
 *   POST /check          grade that one question, statelessly
 *
 * Everything visible here -- the progress bar, the buttons, the pacing, the
 * shuffle -- is ordinary Angular. Replace it with hearts, streaks, a timer per
 * question, or a Duolingo-style lesson path; none of that changes the Edpire
 * side.
 */
@Component({
  selector: 'app-arcade',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <header class="bar">
      <a routerLink="/" class="back">&larr; All assessments</a>

      @if (phase() === 'playing') {
        <div class="progress" role="progressbar" [attr.aria-valuenow]="stepNumber()" aria-valuemin="1"
             [attr.aria-valuemax]="steps().length">
          <div class="progress-fill" [style.width.%]="progressPercent()"></div>
        </div>
        <span class="counter">{{ stepNumber() }} / {{ steps().length }}</span>
      }
    </header>

    @switch (phase()) {
      @case ('loading') {
        <p class="status">Loading the assessment…</p>
      }

      @case ('error') {
        <p class="status status--error">{{ errorMessage() }}</p>
      }

      @case ('setup') {
        <section class="setup">
          <h1>{{ steps().length }} questions, one at a time</h1>
          <label class="toggle">
            <input type="checkbox" [checked]="shuffle()" (change)="toggleShuffle($event)" />
            <span>Shuffle the question order</span>
          </label>
          <p class="hint">
            Order is presentation only. Every answer carries its own question ID, so
            grading is unaffected by the sequence you show them in.
          </p>
          <button class="primary" (click)="start()">Start</button>
        </section>
      }

      @case ('playing') {
        <!-- renderQuestion() mounts into this div. Angular must not touch its
             children afterwards, which is why nothing else is templated inside. -->
        <div #question class="question"></div>

        <footer class="actions">
          @if (!checked()) {
            <button class="primary" [disabled]="!hasAnswer() || checking()" (click)="check()">
              {{ checking() ? 'Checking…' : 'Check' }}
            </button>
          } @else {
            <span class="verdict" [class.verdict--right]="lastCorrect()">
              {{ lastCorrect() ? 'Correct' : 'Not quite' }}
            </span>
            <button class="primary" (click)="next()">
              {{ isLastStep() ? 'Finish' : 'Next question' }}
            </button>
          }
        </footer>
      }

      @case ('done') {
        <section class="setup">
          <h1>{{ result()?.score }} / {{ result()?.max_score }}</h1>
          <p>{{ result()?.percentage }}% &middot; {{ result()?.passed ? 'Passed' : 'Not passed' }}</p>
          @if (result()?.awaiting_manual_grading) {
            <p class="hint">
              This attempt contains open responses awaiting a teacher. The score above is
              provisional -- the final one arrives on the submission.grading.completed webhook.
            </p>
          }
          <a routerLink="/" class="primary as-button">Back to the list</a>
        </section>
      }
    }
  `,
  styles: `
    :host { display: block; max-width: 46rem; margin: 0 auto; padding: 1.5rem; }
    .bar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
    .back { color: #6b7280; text-decoration: none; font-size: .875rem; white-space: nowrap; }
    .back:hover { color: #111827; }
    .progress { flex: 1; height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
    .progress-fill { height: 100%; background: #dc2626; transition: width .25s ease; }
    .counter { font-size: .8125rem; color: #6b7280; font-variant-numeric: tabular-nums; }
    .question { min-height: 18rem; }
    .actions { display: flex; align-items: center; gap: 1rem; margin-top: 2rem;
               padding-top: 1.5rem; border-top: 1px solid #e5e7eb; }
    .verdict { font-weight: 600; color: #dc2626; }
    .verdict--right { color: #047857; }
    .setup { text-align: center; padding: 3rem 0; }
    .setup h1 { font-size: 1.5rem; margin: 0 0 1.5rem; }
    .toggle { display: inline-flex; align-items: center; gap: .5rem; cursor: pointer; }
    .hint { color: #6b7280; font-size: .875rem; max-width: 32rem; margin: 1rem auto; }
    .primary { margin-left: auto; background: #dc2626; color: #fff; border: 0;
               border-radius: .5rem; padding: .625rem 1.25rem; font-size: .9375rem;
               font-weight: 500; cursor: pointer; }
    .primary:disabled { background: #d1d5db; cursor: not-allowed; }
    .as-button { display: inline-block; margin: 1.5rem auto 0; text-decoration: none; }
    .setup .primary { margin: 1.5rem auto 0; display: block; }
    .status { padding: 3rem; text-align: center; color: #6b7280; }
    .status--error { color: #dc2626; }
  `,
})
export class ArcadeComponent {
  private readonly questionEl = viewChild<ElementRef<HTMLDivElement>>('question')

  private readonly api = inject(EdpireApiService)
  private readonly sdkLoader = inject(EdpireSdkService)
  private readonly zone = inject(NgZone)

  /**
   * Bound straight from the `:id` route parameter by withComponentInputBinding()
   * in app.config.ts. No ActivatedRoute subscription, no unsubscribe.
   */
  readonly id = input.required<string>()

  protected readonly phase = signal<'loading' | 'setup' | 'playing' | 'done' | 'error'>('loading')
  protected readonly errorMessage = signal('')
  protected readonly steps = signal<EdpireFlatStep[]>([])
  protected readonly shuffle = signal(true)
  protected readonly current = signal(0)
  protected readonly checked = signal(false)
  protected readonly checking = signal(false)
  protected readonly lastCorrect = signal(false)
  protected readonly hasAnswer = signal(false)
  protected readonly result = signal<GradeResult | null>(null)

  protected readonly stepNumber = computed(() => this.current() + 1)
  protected readonly isLastStep = computed(() => this.current() >= this.steps().length - 1)
  protected readonly progressPercent = computed(() => {
    const total = this.steps().length
    return total === 0 ? 0 : (this.stepNumber() / total) * 100
  })

  /**
   * One session ID for the WHOLE attempt, generated once, here.
   *
   * /check is rate limited at 3 calls per question per session per rolling
   * hour. That limit is keyed on this value, so a fresh ID per question makes
   * the limit fall back to the learner ref, where it accumulates across every
   * retake and eventually 429s a learner who did nothing wrong.
   */
  private readonly sessionId = crypto.randomUUID()

  /** Answers for the question currently on screen. */
  private currentAnswers: EdpireRuntimeAnswer[] = []

  /** Every answer given this attempt, in the order the learner gave them. */
  private readonly collected: EdpireStoredAnswer[] = []

  private instance: EdpireQuestionInstance | null = null

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.instance?.unmount()
      this.instance = null
    })

    effect(() => {
      const id = this.id()
      void this.load(id)
    })

    /**
     * Mount the first question as soon as its container exists.
     *
     * Not in start(): setting phase to 'playing' does not create the div
     * synchronously -- change detection is scheduled, so the element appears a
     * tick later. Reading the viewChild signal here makes this effect re-run at
     * exactly the moment it becomes available, which is the whole point of
     * signal queries. A setTimeout would work by luck; this works by contract.
     */
    effect(() => {
      const el = this.questionEl()?.nativeElement
      if (el && !this.instance) void this.renderCurrent()
    })
  }

  private async load(assessmentId: string): Promise<void> {
    try {
      // The content comes from YOUR server, which holds the API key. The
      // response has no answer keys in it -- the API strips them before they
      // ever leave Edpire, so there is nothing to protect on this side.
      const [assessment, sdk] = await Promise.all([
        this.api.getAssessment(assessmentId),
        this.sdkLoader.load(),
      ])
      this.steps.set(sdk.flattenAssessment(assessment))
      this.phase.set(this.steps().length ? 'setup' : 'error')
      if (!this.steps().length) this.errorMessage.set('This assessment has no questions.')
    } catch (err) {
      this.phase.set('error')
      this.errorMessage.set(describeError(err, 'Could not load the assessment.'))
    }
  }

  protected toggleShuffle(event: Event): void {
    this.shuffle.set((event.target as HTMLInputElement).checked)
  }

  protected start(): void {
    if (this.shuffle()) {
      this.steps.set(shuffled(this.steps()))
    }
    // The effect in the constructor mounts the first question once the
    // container exists. Everything after that is setContent().
    this.phase.set('playing')
  }

  private async renderCurrent(): Promise<void> {
    const el = this.questionEl()?.nativeElement
    if (!el) return

    const step = this.steps()[this.current()]
    if (!step) return

    this.currentAnswers = []
    this.hasAnswer.set(false)
    this.checked.set(false)

    if (this.instance) {
      // setContent also clears feedback, so there is nothing else to reset.
      this.instance.setContent(step.content)
      return
    }

    const sdk = await this.sdkLoader.load()
    this.instance = sdk.renderQuestion({
      container: el,
      content: step.content,
      // Fires on every keystroke and every click inside the question. See the
      // NgZone note in edpire-assessment.component.ts for why this is wrapped.
      onAnswersChange: (answers) => {
        this.zone.run(() => {
          this.currentAnswers = answers
          // A rough readiness check, not validation. Some question types emit
          // an answer object as soon as they mount, so a non-empty array does
          // not prove the learner typed anything. Good enough to keep the
          // button from being pressed on a blank screen; do not mistake it for
          // "the question is answered".
          this.hasAnswer.set(answers.length > 0)
        })
      },
    })
  }

  protected async check(): Promise<void> {
    const step = this.steps()[this.current()]
    if (!step || this.checking()) return

    this.checking.set(true)
    try {
      const res = await this.api.checkQuestion(this.id(), {
        exercise_id: step.exerciseId,
        question_id: step.questionId,
        answers: this.currentAnswers,
        session_id: this.sessionId,
      })
      // Pass /check's `feedback` through untouched. The SDK converts it
      // internally; mapping it yourself is how you get a blank question.
      this.instance?.setFeedback(res.feedback)
      this.lastCorrect.set(res.correct)
    } catch {
      // A 429 here is the brute-force guard, not a bug. Move the learner on
      // rather than trapping them on a question they cannot leave.
      this.lastCorrect.set(false)
    } finally {
      this.checking.set(false)
      this.checked.set(true)
      // Record the answer whether or not the check succeeded. This array is
      // what /submit grades, and /check has recorded nothing.
      this.collected.push({
        exerciseId: step.exerciseId,
        questionId: step.questionId,
        answers: this.currentAnswers,
      })
    }
  }

  protected async next(): Promise<void> {
    if (!this.isLastStep()) {
      this.current.update((i) => i + 1)
      void this.renderCurrent()
      return
    }

    // Last question: record the attempt. Until this call, nothing exists in
    // Edpire -- every /check was stateless.
    this.phase.set('loading')
    try {
      this.result.set(await this.api.submit(this.id(), this.collected))
      this.phase.set('done')
    } catch (err) {
      this.phase.set('error')
      // The one you will actually see here is a missing 'write:submissions'
      // scope on the API key. Exam Hall does not need it -- the embed token
      // authorises that submit -- so a read-only key looks fine right up until
      // an Arcade attempt ends.
      this.errorMessage.set(describeError(err, 'Could not submit the attempt.'))
    }
  }
}

/**
 * Fisher-Yates. Randomises which question is shown when, and nothing else.
 *
 * This is safe because order is not part of the contract: every entry in the
 * submit payload names its own exerciseId and questionId, so Edpire grades the
 * attempt identically whatever sequence the learner saw. You can also shuffle
 * within an exercise only, or pin the first question, by slicing the array
 * before you call this -- it is your array.
 *
 * Not to be confused with shuffling the ANSWER OPTIONS inside a question
 * (choices, drag-drop pools, matching columns). That one is an authoring
 * setting on the question itself, set in the Edpire editor, and the runtime
 * already honours it on every render including this one. You get it for free
 * and there is nothing to write here.
 */
function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}
