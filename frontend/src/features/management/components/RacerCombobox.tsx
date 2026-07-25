import React, { useEffect, useRef, useState } from 'react';
import RacerAvatar from './RacerAvatar';

export interface RacerOption {
  id: number;
  firstName: string;
  lastName: string;
  carNumber?: number | null;
  racerImageUrl?: string | null;
}

interface ComboboxProps {
  racers: RacerOption[];
  value?: number;
  onChange: (racerId: number | undefined) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

function racerLabel(r: RacerOption) {
  return r.carNumber != null ? `#${r.carNumber} ${r.firstName} ${r.lastName}` : `${r.firstName} ${r.lastName}`;
}

export const RacerCombobox: React.FC<ComboboxProps> = ({ racers, value, onChange, placeholder, style }) => {
  const assigned = racers.find((r) => r.id === value);
  const [inputValue, setInputValue] = useState(assigned ? racerLabel(assigned) : '');
  const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const [prevValue, setPrevValue] = useState(value);

  // Keep input text in sync when external value changes (e.g. on initial render)
  if (value !== prevValue) {
    setPrevValue(value);
    if (!isOpen) {
      setInputValue(assigned ? racerLabel(assigned) : '');
    }
  }

  const query = inputValue.trim().toLowerCase();
  const filtered = query
    ? racers.filter((r) => racerLabel(r).toLowerCase().includes(query))
    : racers;

  const handleFocus = () => {
    setInputValue('');
    setIsOpen(true);
    setActiveIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setIsOpen(true);
    setActiveIndex(-1);
  };

  const commit = (racer: RacerOption | undefined) => {
    onChange(racer?.id);
    setInputValue(racer ? racerLabel(racer) : '');
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Ignore blur when focus moves to the dropdown list
    if (containerRef.current?.contains(e.relatedTarget as Node)) return;
    // If user typed something but didn't select, restore previous value
    setInputValue(assigned ? racerLabel(assigned) : '');
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        return;
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) commit(filtered[activeIndex]);
      else if (filtered.length === 1) commit(filtered[0]);
    } else if (e.key === 'Escape') {
      setInputValue(assigned ? racerLabel(assigned) : '');
      setIsOpen(false);
      setActiveIndex(-1);
    } else if (e.key === 'Backspace' && inputValue === '') {
      commit(undefined);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
      if (item && typeof item.scrollIntoView === 'function') {
        item.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex]);

  return (
    <div ref={containerRef} style={{ position: 'relative', zIndex: isOpen ? 100 : 1, ...style }}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        value={inputValue}
        placeholder={placeholder || '— Select racer —'}
        onFocus={handleFocus}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: '1rem',
          padding: '10px',
          borderRadius: '4px',
          border: `1px solid ${isOpen ? 'var(--scouting-blue)' : '#ccc'}`,
          outline: 'none',
        }}
      />
      {isOpen && (
        <ul
          ref={listRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 200,
            margin: '2px 0 0',
            padding: 0,
            listStyle: 'none',
            background: 'white',
            border: '1px solid #ccc',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            maxHeight: '300px',
            overflowY: 'auto',
          }}
        >
          {filtered.length === 0 ? (
            <li style={{ padding: '10px', color: '#888' }}>No matches</li>
          ) : (
            <>
              <li
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(undefined);
                }}
                style={{
                  padding: '10px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #eee',
                  color: '#888',
                  fontStyle: 'italic',
                }}
              >
                — Empty —
              </li>
              {filtered.map((r, i) => (
                <li
                  key={r.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(r);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  style={{
                    padding: '10px',
                    cursor: 'pointer',
                    background: i === activeIndex ? 'var(--scouting-blue)' : 'white',
                    color: i === activeIndex ? 'white' : 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <RacerAvatar
                    racer={{
                      id: r.id,
                      first_name: r.firstName,
                      last_name: r.lastName,
                      racer_image_url: r.racerImageUrl,
                    }}
                    size="40px"
                  />
                  <span>{racerLabel(r)}</span>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
};
