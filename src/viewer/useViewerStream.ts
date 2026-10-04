// src/viewer/useViewerStream.ts
import { useEffect, useReducer } from 'react';
import { INITIAL_MODEL, reduce, type ViewerModel } from './model';

const EVENTS = ['snapshot', 'upsert', 'remove', 'clear', 'state'] as const;

/** The share stream as a model. EventSource reconnects by itself; `ended` closes it for good. */
export function useViewerStream(url = '/events'): ViewerModel {
  const [model, dispatch] = useReducer(reduce, INITIAL_MODEL);
  useEffect(() => {
    const source = new EventSource(url);
    source.onopen = () => dispatch({ type: 'open' });
    source.onerror = () => dispatch({ type: 'error' });
    for (const type of EVENTS) {
      source.addEventListener(type, (event) => {
        try {
          dispatch({ type, ...JSON.parse((event as MessageEvent<string>).data) });
        } catch {
          // A frame that does not parse is skipped; the next snapshot re-syncs the page.
        }
      });
    }
    source.addEventListener('ended', () => {
      dispatch({ type: 'ended' });
      source.close();
    });
    return () => source.close();
  }, [url]);
  return model;
}
