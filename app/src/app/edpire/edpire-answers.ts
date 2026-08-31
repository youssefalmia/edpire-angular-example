import type { EdpireRuntimeAnswer } from './edpire-sdk.types'

/**
 * Has the learner actually answered this question?
 *
 * WHY THIS IS NOT `answers.length > 0`
 * Every player emits an answer for its node as soon as it mounts. A typed blank
 * emits `{ mode: "typed", text: "" }` on its very first render, before the
 * learner has touched anything. So a non-empty array means "there is a question
 * on screen", not "there is an answer in it".
 *
 * Getting this wrong is not cosmetic. `/check` is rate limited to three calls
 * per question per session, so a Check button that is live on an untouched
 * question lets a learner burn a third of their allowance on a blank answer and
 * then hit a 429 on the attempt they cared about.
 *
 * Each branch asks the one question that matters for that answer shape. Unknown
 * types return true rather than false: a question type this app has not been
 * taught about should be checkable, not permanently locked out.
 */
export function isAnswered(answers: readonly EdpireRuntimeAnswer[]): boolean {
  return answers.some((a) => {
    switch (a.type) {
      case 'choiceSet':
      case 'inlineChoiceSet':
        return a.answer.selectedIds.length > 0

      case 'blank':
        // Two shapes share this type: dragged from a pool, or typed.
        return a.answer.mode === 'typed'
          ? a.answer.text.trim().length > 0
          : a.answer.choiceId.length > 0

      case 'matchingSet':
        return a.answer.connections.length > 0

      case 'aiAnswer':
        return a.answer.text.trim().length > 0

      case 'openResponse':
        // Any one of the three modes counts: written, uploaded, or recorded.
        return (
          (a.answer.text?.wordCount ?? 0) > 0 ||
          (a.answer.files?.length ?? 0) > 0 ||
          a.answer.recording !== undefined
        )

      case 'mathResponse':
        return a.answer.latex.trim().length > 0

      case 'codingResponse':
        return a.answer.source.trim().length > 0

      default:
        return true
    }
  })
}
