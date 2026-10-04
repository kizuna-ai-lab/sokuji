// src/viewer/Segmented.tsx
/** The app's segmented control (ModePicker.scss archetype), for the viewer's 2–4-way choices. */
import React from 'react';

interface SegmentedProps<V extends string> {
  label: string;
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange(value: V): void;
}

export default function Segmented<V extends string>({ label, options, value, onChange }: SegmentedProps<V>): React.ReactElement {
  return (
    <div className="viewer-segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`viewer-segmented__option ${o.value === value ? 'active' : ''}`.trim()}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
