// Ask for a reason, and treat Cancel as cancel.
//
// window.prompt returns null when somebody presses Cancel and '' when they press OK on an
// empty box. Three call sites collapsed both to undefined and carried on — so Cancel did
// the thing anyway. On 25 Sep 2026 that removed a real September Dedicated line from the
// revenue figures while its author was only looking at the dialog.
//
// The bug survived because each site re-implemented the same two lines. This is the one
// place that gets it right: null out, string in, and a required reason keeps asking.
export type AskResult = string | null      // null means: they cancelled, do nothing

export function askReason(opts: {
  question: string
  /** When true, an empty answer re-asks instead of being accepted. */
  required?: boolean
  /** Enough to refuse a stray keypress, not a quality bar. */
  minLength?: number
  initial?: string
}): AskResult {
  const min = opts.required ? Math.max(1, opts.minLength ?? 10) : 0
  let value = opts.initial ?? ''
  let ask = opts.question
  for (;;) {
    const typed = window.prompt(ask, value)
    if (typed === null) return null                 // Cancel. Never proceed.
    value = typed.trim()
    if (value.length >= min) return value
    ask = value.length === 0
      ? `A reason is required.\n\n${opts.question}`
      : `Say a little more — that sentence is all anybody will have later.\n\n${opts.question}`
  }
}
