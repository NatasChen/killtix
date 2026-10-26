import { lazy, type ComponentType } from 'react';

/**
 * React.lazy() for a named export: the page's module becomes its own chunk, downloaded the first time the page
 * renders. Pages render inside a <Suspense> (Layout's content area, or Root for the sign-in pages).
 */
export function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
