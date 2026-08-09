/**
 * What the settings page sends for the two PINs (#192).
 *
 * The backend distinguishes three cases and the page could only ever express
 * two of them:
 *
 * | sent | means |
 * | --- | --- |
 * | absent | leave the current PIN alone |
 * | `"1234"` | set it to this |
 * | `""` | clear it |
 *
 * "Absent means leave alone" is load-bearing and not a bug: the page
 * re-submits the whole configuration on every save and is never given the
 * current PIN back, so treating absent as "clear" would switch access control
 * off whenever somebody renamed a track.
 *
 * The consequence was that nothing in the UI could ever send the empty string.
 * A blank field already meant "keep the current one" — the helper text says so
 * — so clearing a PIN was impossible from the app, and `access-and-network.md`
 * documented a recovery that could not work. Removal therefore needs a control
 * of its own rather than a magic empty value, which is what `remove` is.
 *
 * Pure, because the interesting part is a three-way rule about what to send,
 * and that is worth testing without a form around it.
 */

export type PinField = {
  /** What the operator typed. Blank means "leave the current PIN alone". */
  value: string;
  /** Whether they asked for the existing PIN to be removed. */
  remove: boolean;
};

export const blankPin: PinField = { value: '', remove: false };

/**
 * The value to send, or `undefined` to omit the field entirely.
 *
 * Removal wins over a typed value: the field is disabled once removal is
 * staged, so anything still in it is what they typed before changing their
 * mind, and sending it would quietly re-set the PIN they asked to remove.
 */
export function pinToSend(field: PinField): string | undefined {
  if (field.remove) return '';
  return field.value ? field.value : undefined;
}

/** The two PIN fields as the mutation's input wants them. */
export function pinInput(operator: PinField, checkin: PinField) {
  const operatorPin = pinToSend(operator);
  const checkinPin = pinToSend(checkin);
  return {
    ...(operatorPin !== undefined ? { operatorPin } : {}),
    ...(checkinPin !== undefined ? { checkinPin } : {}),
  };
}

/** The helper line under a PIN field, which has to say which of the three it is doing. */
export function pinHelp(field: PinField, isSet: boolean, what: string): string {
  if (field.remove) return `Will be removed when you save. ${what}`;
  if (field.value) return `Will be changed when you save. ${what}`;
  return isSet ? `Leave blank to keep the current PIN. ${what}` : what;
}

/**
 * Whether to offer removal at all.
 *
 * Only for a PIN that exists — there is nothing to remove otherwise, and a
 * button that does nothing is worse than no button on the page somebody has
 * reached because they are locked out.
 */
export function canRemove(isSet: boolean): boolean {
  return isSet;
}
