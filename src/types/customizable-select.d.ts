// Customizable <select> (appearance: base-select, Chromium 135+) introduces
// the <selectedcontent> element, which mirrors the selected option's rich
// markup into the select's closed control. @types/react doesn't know it yet.
import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      selectedcontent: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
