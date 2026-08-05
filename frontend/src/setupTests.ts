import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// jsdom implements no layout, so it has no scrollIntoView. Any component that
// keeps a log or a list pinned to the bottom calls it from an effect and would
// throw on render — a failure about the test environment, not the component.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}
