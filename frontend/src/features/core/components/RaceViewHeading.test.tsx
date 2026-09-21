import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import RaceViewHeading from './RaceViewHeading';

const mockUseNarrowViewport = vi.fn();
vi.mock('../hooks/useNarrowViewport', () => ({
  useNarrowViewport: (...args: unknown[]) => mockUseNarrowViewport(...args),
}));

describe('RaceViewHeading', () => {
  beforeEach(() => {
    mockUseNarrowViewport.mockReturnValue(false);
  });

  it('renders the title, badge and docs link in order inside the h1', () => {
    render(<RaceViewHeading title="Race Control" locked docsKey="control-race" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/Race Control.*Locked/);
    // Order: title text node, then the Locked badge, then the docs link —
    // #1297's own rule.
    const children = Array.from(heading.childNodes);
    const lockedIndex = children.findIndex(
      (n) => n.textContent?.includes('Locked'),
    );
    const docsLink = screen.getByTestId('docs-link');
    expect(heading.contains(docsLink)).toBe(true);
    const docsIndexAmongChildren = children.indexOf(docsLink as unknown as ChildNode);
    expect(lockedIndex).toBeGreaterThanOrEqual(0);
    expect(docsIndexAmongChildren).toBeGreaterThan(lockedIndex);
  });

  it('omits the Locked badge when not locked', () => {
    render(<RaceViewHeading title="Standings" docsKey="standings" />);
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });

  it('omits the docs link when no docsKey is given', () => {
    render(<RaceViewHeading title="Standings" />);
    expect(screen.queryByTestId('docs-link')).not.toBeInTheDocument();
  });

  it('renders a bare h1 with just the title when neither locked nor docsKey nor actions apply', () => {
    render(<RaceViewHeading title="Standings" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Standings');
  });

  it('hides the h1 under 768px but keeps the actions slot', () => {
    mockUseNarrowViewport.mockReturnValue(true);
    render(<RaceViewHeading title="Race Control" locked docsKey="control-race" actions={<button>Edit race</button>} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit race' })).toBeInTheDocument();
  });

  it('keeps the docs link icon visible on a phone when docsInOverflow is false', () => {
    mockUseNarrowViewport.mockReturnValue(true);
    render(<RaceViewHeading title="Stats" docsKey="stats" docsInOverflow={false} />);
    expect(screen.getByTestId('docs-link')).toBeInTheDocument();
  });

  it('hides the docs link icon on a phone when docsInOverflow is true', () => {
    mockUseNarrowViewport.mockReturnValue(true);
    render(<RaceViewHeading title="Race Control" docsKey="control-race" docsInOverflow actions={<button>⋯</button>} />);
    expect(screen.queryByTestId('docs-link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '⋯' })).toBeInTheDocument();
  });

  it('renders nothing at all on a phone when there are no actions and the docs link is covered by an overflow', () => {
    // Roster's own phone shape: "Edit race" and the docs link both move
    // into the roster toolbar's own overflow, so this row would otherwise
    // be an empty div costing its own `margin-bottom` as dead space above
    // the toolbar — reproduced by `mobileChrome.spec.ts`'s own roster
    // density assertion.
    mockUseNarrowViewport.mockReturnValue(true);
    const { container } = render(
      <RaceViewHeading title="Roster" docsKey="roster" docsInOverflow testId="roster-heading" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
