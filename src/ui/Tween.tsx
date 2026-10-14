import { useEffect, useRef, useState } from 'react';

/** A number that glides to its new value instead of jumping (desktop polish; instant when motion is reduced). */
export function useTween(value: number, ms = 650): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value), to = useRef(value), t0 = useRef(0), raf = useRef(0), cur = useRef(value);
  useEffect(() => {
    const reduce = typeof matchMedia !== 'undefined' && (matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(max-width: 900px)').matches);
    if (reduce || !Number.isFinite(value) || Math.abs(value - cur.current) < 1e-9) { cur.current = value; setShown(value); return; }
    from.current = cur.current; to.current = value; t0.current = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0.current) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      cur.current = from.current + (to.current - from.current) * e;
      setShown(cur.current);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, ms]);
  return shown;
}

export function Tween({ value, format, ms }: { value: number; format: (v: number) => string; ms?: number }) {
  const v = useTween(value, ms);
  return <>{format(v)}</>;
}
