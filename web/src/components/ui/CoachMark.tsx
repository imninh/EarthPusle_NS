import { useEffect, useState, type RefObject } from 'react'

const STORAGE_KEY = 'earthpulse.coach.v1'

/** Escape is the only key that dismisses the coach from anywhere on the page. */
export function isCoachCloseKey(key: string): boolean {
  return key === 'Escape'
}

/** Read the dismissal flag safely; a blocked localStorage must not break the app. */
export function shouldShowCoach(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'dismissed'
  } catch {
    return true
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'dismissed')
  } catch {
    // Storage can be disabled. The coach still closes for this visit.
  }
}

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Ask an Earth-system question',
    body: 'Home shows what the data says right now: which variables change, where, how much, and whether the change is significant.',
  },
  {
    title: 'Pick a variable and a period',
    body: 'The Screener ranks every variable by the area with significant change. Discovery puts the same evidence on a world map.',
  },
  {
    title: 'Follow the evidence',
    body: 'Story mode walks through detective cases. A "possible data discontinuity" flag means read the evidence; it is a warning, not a verdict.',
  },
]

/** Dismissible three-step first-visit coach mark. */
export function CoachMark({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean
  onClose: () => void
  /** Element that should receive focus after the coach closes, usually the “?” button. */
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCoachCloseKey(event.key)) return
      event.preventDefault()
      rememberDismissed()
      onClose()
      returnFocusRef?.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, returnFocusRef])

  if (!open) return null
  const current = STEPS[step] ?? STEPS[0]!
  const last = step === STEPS.length - 1

  const close = () => {
    rememberDismissed()
    onClose()
    returnFocusRef?.current?.focus()
  }

  return (
    <div className="coach" role="dialog" aria-labelledby="coach-title" aria-describedby="coach-body">
      <div className="coach-head">
        <span className="coach-kicker">First visit · {step + 1} of {STEPS.length}</span>
        <button type="button" className="coach-close" onClick={close} aria-label="Dismiss the guided tour">
          ×
        </button>
      </div>
      <h2 id="coach-title">{current.title}</h2>
      <p id="coach-body">{current.body}</p>
      <div className="coach-actions">
        <button type="button" className="button ghost" onClick={close}>
          Skip
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => {
            if (last) close()
            else setStep((value) => value + 1)
          }}
        >
          {last ? 'Got it' : 'Next'}
        </button>
      </div>
      <div className="coach-dots" aria-hidden="true">
        {STEPS.map((entry, index) => (
          <span key={entry.title} className={index === step ? 'coach-dot active' : 'coach-dot'} />
        ))}
      </div>
    </div>
  )
}
