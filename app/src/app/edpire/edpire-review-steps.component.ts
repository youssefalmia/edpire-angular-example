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
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core'
import { EdpireApiService } from './edpire-api.service'
import { describeError } from './edpire-error'
import { EdpireSdkService } from './edpire-sdk.service'
import type {
  EdpireQuestionInstance,
  EdpireReviewStep,
  EdpireSdk,
  EdpireSubmissionReview,
} from './edpire-sdk.types'

/**
 * <edpire-review-steps [submissionId]="..."> -- a past attempt, one question
 * per screen, each one locked and marked. Copy this file with the other two.
 *
 * The Arcade twin of <edpire-review>. Same data, same endpoint; the difference
 * is who draws the screen. <edpire-review> hands the whole attempt to the SDK
 * and gets the full paper back. This one asks the SDK for the attempt as a list
 * of steps (`flattenReview`) and draws each with `renderQuestion`, read-only, so
 * the chrome around it -- the dots, Previous and Next, the verdict -- is yours.
 *
 *   <edpire-review-steps
 *     [submissionId]="attempt.submissionId"
 *     [order]="questionIdsInTheOrderTheLearnerSawThem" />
 *
 * `order` is optional. Edpire does not record the order an attempt was shown
 * in, so the steps come back in the assessment's order. If your flow shuffles,
 * keep the order you used and pass it here, and the review pages through the
 * attempt exactly as the learner took it.
 */
@Component({
  selector: 'edpire-review-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status() === 'loading') {
      <p class="rs-status">Loading the corrections…</p>
    } @else if (status() === 'error') {
      <p class="rs-status rs-status--error">{{ errorMessage() }}</p>
    }

    <div class="rs" [class.rs--hidden]="status() !== 'ready'">
      <nav class="rs-dots" aria-label="Questions">
        @for (s of steps(); track s.questionId; let i = $index) {
          <button
            type="button"
            class="rs-dot rs-dot--{{ s.status }}"
            [class.rs-dot--current]="i === index()"
            [attr.aria-label]="'Question ' + (i + 1) + ': ' + label(s)"
            [attr.aria-current]="i === index() ? 'step' : null"
            (click)="go(i)">
            {{ i + 1 }}
          </button>
        }
      </nav>

      @if (current(); as s) {
        <div class="rs-head">
          <span class="rs-n">Question {{ index() + 1 }} of {{ steps().length }}</span>
          <span class="rs-verdict rs-verdict--{{ s.status }}">{{ label(s) }}</span>
          @if (!s.scoreHidden && s.status !== 'awaiting_review' && s.status !== 'unscored') {
            <span class="rs-score">{{ s.score }} / {{ s.maxScore }}</span>
          }
        </div>
      }

      <!-- Two React roots owned by the SDK. Angular templates nothing inside them. -->
      <div #context class="rs-context" [class.rs-context--empty]="!hasContext()"></div>
      <div #question class="rs-question"></div>

      <footer class="rs-nav">
        <button type="button" class="rs-btn" [disabled]="index() === 0" (click)="go(index() - 1)">
          &larr; Previous
        </button>
        <button
          type="button"
          class="rs-btn"
          [disabled]="index() >= steps().length - 1"
          (click)="go(index() + 1)">
          Next &rarr;
        </button>
      </footer>
    </div>
  `,
  styles: `
    :host { display: block; }
    .rs--hidden { display: none; }
    .rs-status { padding: 2rem; text-align: center; color: #6b7280; }
    .rs-status--error { color: #dc2626; }
    .rs-dots { display: flex; flex-wrap: wrap; gap: .375rem; margin-bottom: 1.25rem; }
    .rs-dot { width: 2rem; height: 2rem; border-radius: 999px; border: 1.5px solid transparent;
              font: inherit; font-size: .8125rem; font-weight: 600; cursor: pointer; }
    .rs-dot--correct { background: #ecf8f0; color: #1f8a4c; }
    .rs-dot--partial { background: #fbf1dc; color: #8a5a08; }
    .rs-dot--incorrect { background: #fdeeec; color: #b42318; }
    .rs-dot--awaiting_review, .rs-dot--unscored { background: #f3f4f6; color: #6b7280; }
    .rs-dot--current { border-color: currentColor; }
    .rs-head { display: flex; align-items: baseline; gap: .75rem; margin-bottom: 1rem; }
    .rs-n { font-weight: 600; }
    .rs-verdict { font-size: .8125rem; font-weight: 600; }
    .rs-verdict--correct { color: #1f8a4c; }
    .rs-verdict--partial { color: #8a5a08; }
    .rs-verdict--incorrect { color: #b42318; }
    .rs-verdict--awaiting_review, .rs-verdict--unscored { color: #6b7280; }
    .rs-score { margin-inline-start: auto; font-variant-numeric: tabular-nums; font-weight: 600; }
    /* The passage sits above the question, like the Arcade screen shows it. */
    .rs-context { padding: 1rem; margin-bottom: 1rem; border-radius: .625rem; background: #faf9f7; line-height: 1.6; }
    .rs-context--empty { display: none; }
    .rs-question { line-height: 1.6; }
    .rs-nav { display: flex; justify-content: space-between; margin-top: 1.5rem; }
    .rs-btn { font: inherit; font-size: .875rem; padding: .5rem .875rem; border-radius: .5rem;
              border: 1px solid #d1d5db; background: #fff; color: #111827; cursor: pointer; }
    .rs-btn:disabled { opacity: .4; cursor: default; }
  `,
})
export class EdpireReviewStepsComponent {
  /** The Edpire submission ID, from your own attempts table. */
  readonly submissionId = input.required<string>()
  /** Question IDs in the order the learner saw them. Optional; see the class comment. */
  readonly order = input<readonly string[] | undefined>(undefined)

  /** The attempt's header fields, for your own UI around the steps. */
  readonly loaded = output<EdpireSubmissionReview['submission']>()

  private readonly questionEl = viewChild.required<ElementRef<HTMLDivElement>>('question')
  private readonly contextEl = viewChild.required<ElementRef<HTMLDivElement>>('context')
  private readonly api = inject(EdpireApiService)
  private readonly sdkLoader = inject(EdpireSdkService)
  private readonly zone = inject(NgZone)

  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading')
  protected readonly errorMessage = signal('')
  protected readonly steps = signal<EdpireReviewStep[]>([])
  protected readonly index = signal(0)
  protected readonly hasContext = signal(false)
  protected readonly current = computed(() => this.steps()[this.index()] ?? null)

  private sdk: EdpireSdk | null = null
  private question: EdpireQuestionInstance | null = null
  private context: EdpireQuestionInstance | null = null
  private contextFor: string | null = null
  private generation = 0

  constructor() {
    inject(DestroyRef).onDestroy(() => this.teardown())

    effect(() => {
      const id = this.submissionId()
      const order = this.order()
      untracked(() => void this.load(id, order))
    })

    // Draw whichever step is current, whenever it changes.
    effect(() => {
      const step = this.current()
      if (step && this.sdk) untracked(() => this.draw(step))
    })
  }

  protected go(i: number): void {
    if (i >= 0 && i < this.steps().length) this.index.set(i)
  }

  protected label(s: EdpireReviewStep): string {
    switch (s.status) {
      case 'correct': return 'Correct'
      case 'partial': return 'Partly right'
      case 'incorrect': return 'Not quite'
      case 'awaiting_review': return 'Awaiting teacher'
      case 'unscored': return 'Not marked'
    }
  }

  private async load(submissionId: string, order: readonly string[] | undefined): Promise<void> {
    const generation = ++this.generation
    this.teardown()
    this.status.set('loading')
    try {
      const [review, sdk] = await Promise.all([this.api.review(submissionId), this.sdkLoader.load()])
      if (generation !== this.generation) return
      this.sdk = sdk
      this.steps.set(inOrder(sdk.flattenReview(review), order))
      this.index.set(0)
      this.status.set('ready')
      this.zone.run(() => this.loaded.emit(review.submission))
    } catch (err) {
      if (generation !== this.generation) return
      this.status.set('error')
      this.errorMessage.set(describeError(err, 'Could not load this attempt.'))
    }
  }

  private draw(step: EdpireReviewStep): void {
    const sdk = this.sdk
    if (!sdk) return

    // The passage: re-drawn only when the exercise changes, so paging within
    // one exercise leaves it where the learner was reading.
    this.hasContext.set(step.sharedContext !== null)
    if (this.contextFor !== step.exerciseId) {
      this.contextFor = step.exerciseId
      this.context?.unmount()
      this.context = step.sharedContext === null
        ? null
        : sdk.renderQuestion({ container: this.contextEl().nativeElement, content: step.sharedContext })
    }

    // A fresh root per question, as in Arcade: initialAnswers are only read
    // when a question mounts, so setContent() would show the new question with
    // no answers in it.
    this.question?.unmount()
    this.question = sdk.renderQuestion({
      container: this.questionEl().nativeElement,
      content: step.content,
      initialAnswers: step.answers,
      feedback: step.feedback, // already in /check's shape: pass it through
      readOnly: true,
    })
  }

  private teardown(): void {
    this.question?.unmount()
    this.context?.unmount()
    this.question = null
    this.context = null
    this.contextFor = null
  }
}

/** Reorder steps to the order the learner saw; anything not listed keeps its place at the end. */
function inOrder(steps: EdpireReviewStep[], order: readonly string[] | undefined): EdpireReviewStep[] {
  if (!order?.length) return steps
  const rank = new Map(order.map((id, i) => [id, i]))
  return [...steps].sort(
    (a, b) => (rank.get(a.questionId) ?? Infinity) - (rank.get(b.questionId) ?? Infinity),
  )
}
