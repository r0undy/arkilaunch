// Each shell renders exactly one, matching its own <main id="main">.
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-sm bg-surface px-4 py-2 text-sm font-medium text-text underline focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring"
    >
      Skip to content
    </a>
  );
}
