import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// jsdom implements no layout, so it has no scrollIntoView. Any component that
// keeps a log or a list pinned to the bottom calls it from an effect and would
// throw on render — a failure about the test environment, not the component.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}

// Node 22+ defines its own experimental global `localStorage`, which is
// unavailable unless the process was started with `--localstorage-file`. In
// vitest's jsdom environment `window` *is* `globalThis`, so Node's getter
// shadows jsdom's implementation and `window.localStorage` reads as undefined —
// while `sessionStorage`, which Node does not define, works normally. That
// asymmetry is what makes it look like a bug in the code under test.
//
// It arrived here with the move off end-of-life Node 20 and broke nothing,
// because nothing stored anything at the time. Restoring it keeps the test
// environment behaving like the browser the app actually runs in.
if (typeof globalThis !== 'undefined' && !globalThis.localStorage) {
    let entries = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return entries.size;
        },
        clear: () => {
            entries = new Map();
        },
        getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
        key: (index: number) => Array.from(entries.keys())[index] ?? null,
        removeItem: (key: string) => {
            entries.delete(key);
        },
        setItem: (key: string, value: string) => {
            entries.set(key, String(value));
        },
    };
    Object.defineProperty(globalThis, 'localStorage', {
        value: storage,
        configurable: true,
        writable: false,
    });
}

// jsdom's Blob has no `stream()`. `fetch`/`Response` in vitest's jsdom
// environment are Node's own (built on undici), and vitest's jsdom
// environment replaces `globalThis.Blob` with jsdom's — so a `new
// Response(someBlob)` reaches Node's fetch internals, which recognise the
// object as a Blob (it checks `instanceof globalThis.Blob`) and read its body
// through `.stream()`, same as a browser's Response would for a real Blob. A
// real browser's Blob and Response always come from the same implementation
// and so never hit this gap.
//
// Confirmed present under Node 22.23.1 with the jsdom and vitest versions
// this project pins as of #690, and absent under the Node 24 CI pins — the
// exact difference on the Node 24 side was not tracked down, only that the
// suite is green there. A single-chunk ReadableStream over the Blob's own
// bytes is a faithful `stream()` for anything a test does with the result —
// reading the body's length or its full content — which is all any test here
// needs. Delete this once the project's minimum supported Node version no
// longer needs it (or jsdom implements `stream()` itself).
if (typeof Blob !== 'undefined' && !Blob.prototype.stream) {
    Blob.prototype.stream = function (this: Blob) {
        return new ReadableStream({
            start: async (controller) => {
                const buffer = await this.arrayBuffer();
                controller.enqueue(new Uint8Array(buffer));
                controller.close();
            },
        });
    } as Blob['stream'];
}
