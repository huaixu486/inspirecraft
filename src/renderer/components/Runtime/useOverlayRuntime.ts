import { useCallback, useEffect, useRef, useState } from 'react';
import { AppPage } from '../../stores/navigationStore';

type OverlayPage = 'settings' | 'recycle-bin';

export const useOverlayRuntime = (navigate: (page: AppPage) => void) => {
  const timerRef = useRef<number>(0);
  const [reveal, setReveal] = useState<{ page: OverlayPage | null; x: number; y: number; phase: 'idle' | 'opening' | 'open' | 'fading' }>({ page: null, x: 0, y: 0, phase: 'idle' });

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const open = useCallback((targetPage: OverlayPage, event: React.MouseEvent) => {
    if (reveal.phase === 'opening') return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (reveal.phase === 'open' || reveal.phase === 'fading') {
      navigate(targetPage);
      setReveal(current => ({ ...current, page: targetPage, phase: 'fading' }));
      timerRef.current = window.setTimeout(() => { timerRef.current = 0; setReveal({ page: null, x: 0, y: 0, phase: 'idle' }); }, 300);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setReveal({ page: targetPage, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, phase: 'opening' });
    timerRef.current = window.setTimeout(() => {
      navigate(targetPage);
      setReveal(current => ({ ...current, phase: 'fading' }));
      timerRef.current = window.setTimeout(() => { timerRef.current = 0; setReveal({ page: null, x: 0, y: 0, phase: 'idle' }); }, 300);
    }, 420);
  }, [navigate, reveal.phase]);

  const close = useCallback(() => {
    if (reveal.phase === 'opening') return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (reveal.phase === 'idle') { navigate('overview'); return; }
    setReveal(current => ({ ...current, phase: 'open' }));
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0;
      navigate('overview');
      setReveal({ page: null, x: 0, y: 0, phase: 'idle' });
    }, 60);
  }, [navigate, reveal.phase]);

  return { reveal, open, close };
};
