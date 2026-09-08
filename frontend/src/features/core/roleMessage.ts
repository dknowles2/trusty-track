/**
 * The sentence a control's tooltip shows when this device's role cannot
 * reach it (#892) — matching `backend/api/auth.py`'s `_pin_needed_for` word
 * for word, the same way `raceLockMessage.ts`'s `RACE_LOCKED_MESSAGE`
 * matches `api/race_lock.py`'s `LOCK_MESSAGE`. Two copies of the same
 * sentence rather than one shared string, because the two ends are two
 * languages — but naming this constant after the backend's is what keeps a
 * future edit to one a prompt to check the other.
 *
 * A screen hiding or disabling a control based on role is advisory: the
 * server is still the only place a mutation is actually refused
 * (`RolePolicyExtension`), and this text is only ever reached if that
 * refusal would also have fired. If the two ever disagree, the control being
 * shown and then refused — with this same sentence — is the safe failure,
 * not a hole in what is allowed.
 */
export const NEEDS_CHECKIN_PIN_MESSAGE =
  'That needs the check-in PIN. Enter it with the lock icon in the top bar.';

export const NEEDS_OPERATOR_PIN_MESSAGE =
  'That needs the operator PIN. Enter it with the lock icon in the top bar.';
