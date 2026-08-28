/**
 * Copying plain text to the clipboard, for the voting page's Copy button
 * (#414) — the address is long enough, and typed by a volunteer, that
 * "select it and Ctrl+C" is worth removing as a step.
 *
 * `navigator.clipboard.writeText` is the ordinary path, but it needs a
 * secure context (HTTPS, or `localhost`) and is entirely absent from some
 * embedded/older browsers a wall display or a check-in tablet might be
 * running. `document.execCommand('copy')` against a hidden, briefly
 * focused textarea is the fallback every browser still understands, even
 * though it is deprecated — there is nothing to deprecate it *to* here,
 * since the modern API is the thing it would be replaced by and that is
 * exactly what is unavailable.
 */

function copyWithExecCommand(text: string): boolean {
    if (typeof document === 'undefined') return false;

    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Off-screen rather than `display: none` — some browsers refuse to
    // focus/select an element that renders nothing at all.
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch {
        copied = false;
    } finally {
        document.body.removeChild(textarea);
    }
    return copied;
}

/** Resolves `true` if the text made it to the clipboard, `false` otherwise —
 * never rejects, so a caller can show one message either way. */
export async function copyText(text: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Falls through to the fallback below — a permission refusal is
            // still worth trying the older path for.
        }
    }
    return copyWithExecCommand(text);
}
