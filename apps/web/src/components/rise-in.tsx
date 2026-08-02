import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface RiseInProps {
  children: ReactNode;
  className?: string;
}

// DSD §4/§5 RiseIn: opacity-0 translate-y-4 -> opacity-100 translate-y-0,
// IntersectionObserver-driven, 700ms ease-out. Collapses to instant under
// prefers-reduced-motion via the global rule in index.css.
export function RiseIn({ children, className = '' }: RiseInProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={[
        'transition-all duration-700 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}
