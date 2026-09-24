/**
 * Returns a ref that tracks whether the component is still mounted.
 *
 * Used to avoid setting state on unmounted components, which causes memory
 * leaks and console warnings in React.
 */
import { useEffect, useRef } from 'react';

export function useIsMounted() {
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return mounted;
}
