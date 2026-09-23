import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { DatePipe } from '@angular/common'
import { RouterLink } from '@angular/router'
import { EdpireApiService } from '../edpire/edpire-api.service'
import { describeError } from '../edpire/edpire-error'
import type { LibraryCard } from '../edpire/edpire-sdk.types'

/**
 * My assessments: every assessment as a card, each showing where this learner
 * stands with it.
 *
 *   Not started           -> Start
 *   Finished, with score  -> Review (the corrected paper) or Retry
 *   Awaiting a teacher    -> Review; the score is withheld until it is final
 *
 * This screen makes ONE call, to your own backend, and every card arrives with
 * its state already decided (see `cardFor` in server/attempts.mjs). Nothing
 * here talks to Edpire, so the page is as fast and as available as your own
 * API. That is the reason your backend keeps a small attempts table rather than
 * asking Edpire per card.
 */
@Component({
  selector: 'app-library',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe],
  template: `
    <header class="head">
      <h1>My assessments</h1>
      <a routerLink="/modes" class="aside">Integration modes playground &rarr;</a>
    </header>

    @if (loading()) {
      <p class="status">Loading…</p>
    } @else if (error()) {
      <p class="status status--error">{{ error() }}</p>
      <p class="hint">Is the server running on :8787, and is EDPIRE_API_KEY set in server/.env?</p>
    } @else if (cards().length === 0) {
      <p class="status">Nothing published in this organisation yet.</p>
    } @else {
      <ul class="grid">
        @for (c of cards(); track c.id) {
          <li class="card" [class.card--done]="c.state === 'done'" [class.card--grading]="c.state === 'grading'">
            <div class="top">
              @if (c.category) { <span class="chip">{{ c.category }}</span> }
              @switch (c.state) {
                @case ('new') { <span class="badge">Not started</span> }
                @case ('grading') { <span class="badge badge--amber">Awaiting teacher</span> }
                @case ('done') {
                  <span class="badge" [class.badge--green]="c.latest?.passed" [class.badge--red]="c.latest?.passed === false">
                    {{ c.latest?.passed ? 'Passed' : 'Finished' }}
                  </span>
                }
              }
            </div>

            <h2 class="title">{{ c.title }}</h2>

            <!-- The score block: the one thing that changes between states -->
            @if (c.latest; as l) {
              @if (c.state === 'done') {
                <p class="score" [class.score--pass]="l.passed" [class.score--fail]="l.passed === false">
                  {{ l.score }}<span class="of"> / {{ l.maxScore }}</span>
                  <span class="pct">{{ l.percentage }}%</span>
                </p>
              } @else {
                <p class="score score--pending">Score pending</p>
              }
              <p class="meta">
                Attempt {{ l.attemptNumber }} &middot; {{ l.submittedAt | date: 'mediumDate' }}
                @if (c.best && c.best.submissionId !== l.submissionId) {
                  &middot; best {{ c.best.percentage }}%
                }
              </p>
            } @else {
              <p class="meta">
                @if (c.maxScore) { {{ c.maxScore }} points &middot; }
                {{ c.attemptsLeft === null ? 'Unlimited attempts' : c.attemptsLeft + ' attempts allowed' }}
              </p>
            }

            <div class="actions">
              @if (c.state === 'new') {
                <a class="btn" [routerLink]="['/assessments', c.id, 'take']">Start</a>
              } @else {
                <a class="btn btn--ghost" [routerLink]="['/assessments', c.id]">
                  Review{{ c.attemptsUsed > 1 ? ' (' + c.attemptsUsed + ' attempts)' : '' }}
                </a>
                @if (c.canRetry) {
                  <a class="btn" [routerLink]="['/assessments', c.id, 'take']">Retry</a>
                } @else {
                  <span class="none">No attempts left</span>
                }
              }
            </div>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: block; max-width: 72rem; margin: 0 auto; padding: 2.5rem 1.5rem; }
    .head { display: flex; align-items: baseline; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
    h1 { font-size: 1.75rem; margin: 0; }
    .aside { margin-inline-start: auto; font-size: .8125rem; color: #6b7280; text-decoration: none; }
    .aside:hover { color: #111827; }
    .grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 1rem;
            grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); }
    .card { display: flex; flex-direction: column; gap: .5rem; padding: 1.25rem; border-radius: .875rem;
            border: 1px solid #e5e7eb; background: #fff; }
    .card--done { border-color: #d1d5db; background: #fafafa; }
    .card--grading { border-color: #f2e2bf; background: #fffbf2; }
    .top { display: flex; align-items: center; gap: .5rem; min-height: 1.5rem; }
    .chip { font-size: .75rem; color: #4b5563; background: #f3f4f6; border-radius: 999px; padding: .125rem .5rem; }
    .badge { margin-inline-start: auto; font-size: .75rem; font-weight: 600; color: #6b7280; }
    .badge--green { color: #1f8a4c; }
    .badge--red { color: #b42318; }
    .badge--amber { color: #8a5a08; }
    .title { font-size: 1.0625rem; font-weight: 600; margin: 0; line-height: 1.35; }
    .score { margin: .25rem 0 0; font-size: 1.75rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
    .score .of { font-size: 1rem; font-weight: 500; color: #6b7280; }
    .score .pct { font-size: .875rem; font-weight: 600; margin-inline-start: .5rem; }
    .score--pass { color: #1f8a4c; }
    .score--fail { color: #b42318; }
    .score--pending { font-size: 1rem; color: #8a5a08; font-weight: 600; }
    .meta { margin: 0; font-size: .8125rem; color: #6b7280; }
    .actions { display: flex; gap: .5rem; align-items: center; margin-top: auto; padding-top: .75rem; }
    .btn { background: #dc2626; color: #fff; border-radius: .5rem; padding: .5rem .875rem; font-size: .875rem;
           text-decoration: none; white-space: nowrap; }
    .btn--ghost { background: transparent; color: #dc2626; box-shadow: inset 0 0 0 1px #dc2626; }
    .none { font-size: .8125rem; color: #6b7280; }
    .status { padding: 2rem 0; color: #6b7280; }
    .status--error { color: #dc2626; }
    .hint { color: #6b7280; font-size: .875rem; }
  `,
})
export class LibraryComponent {
  private readonly api = inject(EdpireApiService)

  protected readonly cards = signal<LibraryCard[]>([])
  protected readonly loading = signal(true)
  protected readonly error = signal('')

  constructor() {
    this.api
      .library()
      .then((cards) => this.cards.set(cards))
      .catch((err: unknown) => this.error.set(describeError(err, 'Could not load your assessments.')))
      .finally(() => this.loading.set(false))
  }
}
