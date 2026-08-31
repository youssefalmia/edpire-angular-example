import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { EdpireApiService } from '../edpire/edpire-api.service'
import { describeError } from '../edpire/edpire-error'
import type { AssessmentListItem } from '../edpire/edpire-sdk.types'

/**
 * The list of playable assessments.
 *
 * This screen is scaffolding, not integration. Your product already knows which
 * lesson a learner is on; it would open the player directly rather than asking
 * them to pick from a list of everything in the organisation.
 *
 * The one idea worth keeping is that titles come from Edpire while the decision
 * of what to show belongs to you. In production you store the assessment UUID
 * against your own lesson row -- one nullable `edpire_assessment_id` column --
 * and that column is the entire contract between the two catalogues.
 */
@Component({
  selector: 'app-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <h1>Edpire &times; Angular</h1>
    <p class="lede">
      The same assessment, delivered two ways. Exam Hall is the whole paper, drawn by
      Edpire. Arcade is one question per screen, drawn by you.
    </p>

    @if (loading()) {
      <p class="status">Loading…</p>
    } @else if (error()) {
      <p class="status status--error">{{ error() }}</p>
      <p class="hint">
        Is the token server running on :8787, and is EDPIRE_API_KEY set in server/.env?
      </p>
    } @else if (assessments().length === 0) {
      <p class="status">Nothing published in this organisation yet.</p>
      <p class="hint">
        Create an assessment at edpire.com and publish it. Drafts never appear here.
      </p>
    } @else {
      <ul class="list">
        @for (a of assessments(); track a.id) {
          <li class="row">
            <div class="meta">
              <span class="title">{{ a.title }}</span>
              @if (a.exerciseCount !== null) {
                <span class="sub">{{ a.exerciseCount }} exercises</span>
              }
            </div>
            <a class="btn" [routerLink]="['/exam', a.id]">Exam Hall</a>
            <a class="btn btn--ghost" [routerLink]="['/arcade', a.id]">Arcade</a>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: block; max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem; }
    h1 { font-size: 1.75rem; margin: 0 0 .5rem; }
    .lede { color: #4b5563; margin: 0 0 2.5rem; line-height: 1.6; }
    .list { list-style: none; padding: 0; margin: 0; }
    .row { display: flex; align-items: center; gap: .75rem; padding: 1rem 0;
           border-bottom: 1px solid #e5e7eb; }
    .meta { flex: 1; min-width: 0; }
    .title { display: block; font-weight: 500; }
    .sub { display: block; font-size: .8125rem; color: #6b7280; }
    .btn { background: #dc2626; color: #fff; border-radius: .5rem; padding: .5rem 1rem;
           font-size: .875rem; text-decoration: none; white-space: nowrap; }
    .btn--ghost { background: transparent; color: #dc2626; box-shadow: inset 0 0 0 1px #dc2626; }
    .status { padding: 2rem 0; color: #6b7280; }
    .status--error { color: #dc2626; }
    .hint { color: #6b7280; font-size: .875rem; }
  `,
})
export class PickerComponent {
  private readonly api = inject(EdpireApiService)

  protected readonly assessments = signal<AssessmentListItem[]>([])
  protected readonly loading = signal(true)
  protected readonly error = signal('')

  constructor() {
    this.api
      .listAssessments()
      .then((items) => this.assessments.set(items))
      .catch((err: unknown) =>
        this.error.set(describeError(err, 'Could not reach the token server.')),
      )
      .finally(() => this.loading.set(false))
  }
}
