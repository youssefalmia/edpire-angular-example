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
import { isAnswered } from '../edpire/edpire-answers'
import { describeError } from '../edpire/edpire-error'
import { EdpireSdkService } from '../edpire/edpire-sdk.service'
import type {
  AssessmentPayload,
  CheckResult,
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
 * Everything visible here -- the card, the progress bar, the result banner, the
 * pacing, the shuffle -- is ordinary Angular. Replace it with hearts, streaks,
 * a per-question timer or a lesson path; none of that changes the Edpire side.
 *
 * TWO THINGS THIS SCREEN DOES THAT ARE EASY TO MISS
 *
 * 1. It renders the exercise's shared context. `flattenAssessment()` returns
 *    questions only, so a reading passage or worked example attached to the
 *    exercise is not in the steps. Drop it and a comprehension question becomes
 *    unanswerable. See `contextInstance` below.
 * 2. It gives the question somewhere decent to live. The SDK styles the parts
 *    that carry meaning -- the marking colours, the blanks, the word bank --
 *    and deliberately inherits everything else from you, so questions look like
 *    your product rather than like an iframe. That is a feature, but it means a
 *    page with no typography of its own renders a question with no typography.
 *    The `.paper` rules below are the minimum worth giving it.
 */
@Component({
  selector: 'app-arcade',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <header class="bar">
      <a routerLink="/modes" class="back" aria-label="Back to all assessments">&larr;</a>
      <span class="bar-title">{{ title() }}</span>

      @if (phase() === 'playing') {
        <div
          class="progress"
          role="progressbar"
          [attr.aria-valuenow]="stepNumber()"
          aria-valuemin="1"
          [attr.aria-valuemax]="steps().length"
        >
          <div class="progress-fill" [style.width.%]="progressPercent()"></div>
        </div>
        <span class="counter">{{ stepNumber() }} / {{ steps().length }}</span>
      }
    </header>

    @switch (phase()) {
      @case ('loading') {
        <p class="status">Loading…</p>
      }

      @case ('error') {
        <p class="status status--error">{{ errorMessage() }}</p>
      }

      @case ('setup') {
        <section class="panel">
          <h1>{{ steps().length }} questions, one at a time</h1>
          <label class="toggle">
            <input type="checkbox" [checked]="shuffle()" (change)="toggleShuffle($event)" />
            <span>Shuffle the question order</span>
          </label>
          <p class="hint">
            Order is presentation only. Every answer carries its own question ID, so grading
            is unaffected by the sequence you show them in.
          </p>
          <button class="primary" (click)="start()">Start</button>
        </section>
      }

      @case ('playing') {
        <article class="paper">
          <div class="paper-head">
            <span class="q-label">Question {{ stepNumber() }}</span>
            <span class="q-points">{{ currentPoints() }} {{ currentPoints() === 1 ? 'point' : 'points' }}</span>
          </div>

          <!--
            Both of these are React roots owned by the SDK. Angular must not
            template anything inside them, or the two fight over the same DOM.
            The context div stays in the tree even when empty so its React root
            survives between questions in the same exercise.
          -->
          <div #context class="context" [class.context--empty]="!hasContext()"></div>
          <div #question class="question"></div>

          @if (result(); as r) {
            @if (r.message) {
              <!--
                The check itself failed, so there is no marking on the question
                and nothing was graded. Say that, rather than showing a score of
                zero the learner did not earn.
              -->
              <div class="verdict verdict--muted">
                <strong>Could not check this one</strong>
                <span class="verdict-note">{{ r.message }}</span>
              </div>
            } @else {
              <div class="verdict" [class.verdict--right]="r.correct">
                <strong>{{ r.correct ? 'Correct' : 'Not quite' }}</strong>
                <span>{{ r.score }} / {{ r.max_score }}</span>
                @if (!r.correct) {
                  <span class="verdict-note">The answer is marked on the question above.</span>
                }
              </div>
            }
          }
        </article>

        <footer class="actions">
          @if (!result()) {
            <button class="primary" [disabled]="!canCheck() || checking()" (click)="check()">
              {{ checking() ? 'Checking…' : 'Check' }}
            </button>
          } @else {
            <button class="primary" (click)="next()">
              {{ isLastStep() ? 'Finish' : 'Next question' }}
            </button>
          }
        </footer>
      }

      @case ('done') {
        <section class="panel">
          <p class="final-score">{{ grade()?.score }} / {{ grade()?.max_score }}</p>
          <p class="final-sub">
            {{ grade()?.percentage }}% &middot; {{ grade()?.passed ? 'Passed' : 'Not passed' }}
          </p>
          @if (grade()?.awaiting_manual_grading) {
            <p class="hint">
              This attempt contains open responses awaiting a teacher, so the score above is
              provisional. The final one arrives on the submission.grading.completed webhook.
            </p>
          }
          <a routerLink="/modes" class="primary as-button">Back to the list</a>
        </section>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      max-width: 44rem;
      margin: 0 auto;
      padding: 1.25rem 1.25rem 4rem;
    }

    /* -- Header ------------------------------------------------------------ */
    .bar { display: flex; align-items: center; gap: .75rem; margin-bottom: 1.5rem; }
    .back { color: #6b7280; text-decoration: none; font-size: 1.125rem; line-height: 1; }
    .back:hover { color: #111827; }
    .bar-title {
      font-size: .8125rem; color: #6b7280; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; max-width: 14rem;
    }
    .progress { flex: 1; height: 5px; background: #e9e7e3; border-radius: 999px; overflow: hidden; }
    .progress-fill { height: 100%; background: #d23b2b; transition: width .3s ease; }
    .counter { font-size: .8125rem; color: #6b7280; font-variant-numeric: tabular-nums; }

    /* -- The question card ------------------------------------------------- */
    .paper {
      background: #fff;
      border: 1px solid #e7e5e0;
      border-radius: .875rem;
      box-shadow: 0 1px 2px rgb(16 24 40 / 4%), 0 8px 24px rgb(16 24 40 / 4%);
      padding: 1.75rem;
    }
    .paper-head {
      display: flex; align-items: baseline; justify-content: space-between;
      margin-bottom: 1.25rem; padding-bottom: .75rem; border-bottom: 1px solid #f0eeea;
    }
    .q-label { font-size: .75rem; font-weight: 600; letter-spacing: .06em;
               text-transform: uppercase; color: #8d93a0; }
    .q-points { font-size: .8125rem; color: #8d93a0; }

    /*
      The typographic environment the SDK inherits. Without this the question
      renders at the browser default and looks like an unstyled document, which
      reads as "the SDK is broken" when it is doing exactly what it promises.
    */
    .context, .question {
      font-size: 1.0625rem;
      line-height: 1.75;
      color: #1d2025;
    }
    /*
      Only ever set inherited properties here -- font, colour, line height.
      Do NOT restyle the question's own boxes. A blank that runs the full width
      of the card is usually the author saying "this answer is a sentence", set
      per blank in the editor; capping it with a max-width silently overrides an
      authoring decision you cannot see from here. The one exception is the
      image rule below, which prevents an oversized asset overflowing the card
      rather than changing any layout the author chose.
    */
    .question img, .context img { max-width: 100%; height: auto; border-radius: .5rem; }

    .context {
      margin-bottom: 1.5rem;
      padding: 1rem 1.125rem;
      background: #faf9f7;
      border-left: 3px solid #e7e5e0;
      border-radius: 0 .5rem .5rem 0;
      font-size: 1rem;
    }
    /* No shared context on this exercise: collapse it entirely, no empty box. */
    .context--empty { display: none; }

    /* -- Result ------------------------------------------------------------ */
    .verdict {
      display: flex; align-items: baseline; gap: .625rem; flex-wrap: wrap;
      margin-top: 1.5rem; padding: .875rem 1rem; border-radius: .5rem;
      background: #fdeeec; color: #d23b2b; font-size: .9375rem;
    }
    .verdict--right { background: #ecf8f0; color: #1f8a4c; }
    .verdict--muted { background: #f5f4f1; color: #565b66; }
    .verdict strong { font-size: 1rem; }
    .verdict span { font-variant-numeric: tabular-nums; }
    .verdict-note { color: inherit; opacity: .75; font-size: .8125rem; }

    /* -- Actions ----------------------------------------------------------- */
    .actions { display: flex; justify-content: flex-end; margin-top: 1.25rem; }
    .primary {
      background: #d23b2b; color: #fff; border: 0; border-radius: .5rem;
      padding: .6875rem 1.5rem; font: inherit; font-weight: 500; cursor: pointer;
    }
    .primary:hover:not(:disabled) { background: #b83226; }
    .primary:disabled { background: #d6d3cc; cursor: not-allowed; }

    /* -- Setup and result panels ------------------------------------------- */
    .panel { text-align: center; padding: 3.5rem 1rem; }
    .panel h1 { font-size: 1.375rem; margin: 0 0 1.5rem; }
    .toggle { display: inline-flex; align-items: center; gap: .5rem; cursor: pointer; }
    .hint { color: #6b7280; font-size: .875rem; max-width: 30rem; margin: 1rem auto 0;
            line-height: 1.6; }
    .panel .primary { margin: 1.75rem auto 0; display: block; }
    .as-button { display: inline-block; text-decoration: none; }
    .final-score { font-size: 2.5rem; font-weight: 600; margin: 0;
                   font-variant-numeric: tabular-nums; }
    .final-sub { color: #6b7280; margin: .375rem 0 0; }
    .status { padding: 3.5rem 1rem; text-align: center; color: #6b7280; }
    .status--error { color: #d23b2b; }
  `,
})
export class ArcadeComponent {
  private readonly questionEl = viewChild<ElementRef<HTMLDivElement>>('question')
  private readonly contextEl = viewChild<ElementRef<HTMLDivElement>>('context')

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
  protected readonly title = signal('')
  protected readonly steps = signal<EdpireFlatStep[]>([])
  protected readonly shuffle = signal(true)
  protected readonly current = signal(0)
  protected readonly checking = signal(false)
  protected readonly canCheck = signal(false)
  protected readonly hasContext = signal(false)
  /** The last /check response, or null while the learner is still working. */
  protected readonly result = signal<CheckResult | null>(null)
  protected readonly grade = signal<GradeResult | null>(null)

  protected readonly stepNumber = computed(() => this.current() + 1)
  protected readonly isLastStep = computed(() => this.current() >= this.steps().length - 1)
  protected readonly currentPoints = computed(() => this.steps()[this.current()]?.points ?? 0)
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

  /**
   * The assessment as it arrived, kept because `flattenAssessment()` throws the
   * exercise wrapper away and the shared context lives on it.
   */
  private assessment: AssessmentPayload | null = null
  /** Which exercise's context is currently mounted, so we only re-render on change. */
  private mountedContextFor: string | null = null

  private currentAnswers: EdpireRuntimeAnswer[] = []
  private readonly collected: EdpireStoredAnswer[] = []

  private instance: EdpireQuestionInstance | null = null
  private contextInstance: EdpireQuestionInstance | null = null

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.instance?.unmount()
      this.contextInstance?.unmount()
      this.instance = null
      this.contextInstance = null
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
      if (el && !this.instance) void this.render()
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
      this.assessment = assessment
      this.title.set(assessment.title)
      this.steps.set(sdk.flattenAssessment(assessment))
      if (this.steps().length === 0) {
        this.errorMessage.set('This assessment has no questions.')
        this.phase.set('error')
        return
      }
      this.phase.set('setup')
    } catch (err) {
      this.errorMessage.set(describeError(err, 'Could not load the assessment.'))
      this.phase.set('error')
    }
  }

  protected toggleShuffle(event: Event): void {
    this.shuffle.set((event.target as HTMLInputElement).checked)
  }

  protected start(): void {
    if (this.shuffle()) this.steps.set(shuffled(this.steps()))
    // The effect in the constructor mounts the first question once the
    // container exists. Everything after that is setContent().
    this.phase.set('playing')
  }

  /** Mount or update both React roots for the step now at `current()`. */
  private async render(): Promise<void> {
    const el = this.questionEl()?.nativeElement
    const step = this.steps()[this.current()]
    if (!el || !step) return

    this.currentAnswers = []
    this.canCheck.set(false)
    this.result.set(null)

    const sdk = await this.sdkLoader.load()

    // -- The exercise's shared context, if it has one ------------------------
    // Rendered with renderQuestion because a shared context is the same content
    // AST as a question; it simply contains prose and figures rather than
    // inputs, so nothing interactive appears. Re-mounted only when the exercise
    // changes, so paging within one exercise leaves the passage untouched.
    const context = this.contextFor(step.exerciseId)
    this.hasContext.set(context !== null)
    if (this.mountedContextFor !== step.exerciseId) {
      this.mountedContextFor = step.exerciseId
      const contextEl = this.contextEl()?.nativeElement
      if (contextEl) {
        if (context === null) {
          this.contextInstance?.unmount()
          this.contextInstance = null
        } else if (this.contextInstance) {
          this.contextInstance.setContent(context)
        } else {
          this.contextInstance = sdk.renderQuestion({ container: contextEl, content: context })
        }
      }
    }

    // -- The question --------------------------------------------------------
    //
    // DO NOT reuse the instance with setContent() here, however tempting.
    //
    // setContent() swaps the content and clears the feedback, but it does NOT
    // clear collected answers: the question runtime keeps one answer bus for
    // the life of the React root, and `onAnswersChange` reports everything that
    // bus has ever seen. Page through three questions with setContent and the
    // third /check is sent the first two questions' answers as well -- nodes
    // that are not even on screen. It grades by node ID so it often still looks
    // right, which is what makes it dangerous: the payloads are wrong long
    // before anything visibly breaks, and the final submit carries the lot.
    //
    // A fresh root per question is the fix. Unmounting is cheap, it happens
    // once per question rather than per keystroke, and it makes "the answers
    // for this question" mean exactly that.
    this.instance?.unmount()
    this.instance = sdk.renderQuestion({
      container: el,
      content: step.content,
      // Fires on every keystroke and every click inside the question. See the
      // NgZone note in edpire-assessment.component.ts for why this is wrapped.
      onAnswersChange: (answers) => {
        this.zone.run(() => {
          this.currentAnswers = answers
          this.canCheck.set(isAnswered(answers))
        })
      },
    })
  }

  /** The shared context AST for an exercise, or null when it has none. */
  private contextFor(exerciseId: string): unknown | null {
    const exercise = this.assessment?.exercises.find((e) => e.id === exerciseId)
    return exercise?.shared_context ?? null
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
      this.result.set(res)
    } catch (err) {
      // A 429 here is the brute-force guard, not a bug. Let the learner move
      // on rather than trapping them on a question they cannot leave.
      // Not a score of zero -- nothing was graded. `message` makes the
      // template render the "could not check" state instead of a mark.
      this.result.set({
        correct: false,
        score: 0,
        max_score: step.points,
        feedback: {},
        message: describeError(err, 'Could not reach the grader. Your answer was kept.'),
      })
    } finally {
      this.checking.set(false)
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
      void this.render()
      return
    }

    // Last question: record the attempt. Until this call nothing exists in
    // Edpire -- every /check was stateless.
    this.phase.set('loading')
    try {
      this.grade.set(await this.api.submit(this.id(), this.collected))
      this.phase.set('done')
    } catch (err) {
      // The one you will actually see here is a missing 'write:submissions'
      // scope on the API key. Exam Hall does not need it -- the embed token
      // authorises that submit -- so a read-only key looks fine right up until
      // an Arcade attempt ends.
      this.errorMessage.set(describeError(err, 'Could not submit the attempt.'))
      this.phase.set('error')
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
