// The first tab stop on every page: jump past the nav to the content.
//
// Without it a keyboard or screen-reader user tabs the whole sidebar --
// fifteen destinations in the account shell -- on every single page load
// before reaching anything they came for.
//
// Hidden until focused, then a real, visible target (DESIGN.md §6: focus is
// never invisible). Each shell renders exactly one of these and puts the
// matching `id="main"` on its own <main>, so a page never has two.
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
