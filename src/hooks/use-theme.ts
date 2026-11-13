import { useEffect, useState } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';

export interface Theme {
  /** What the person chose. */
  pref: ThemePref;
  /** What is showing right now. */
  effective: 'light' | 'dark';
  setPref: (pref: ThemePref) => void;
}

/** Light/dark mode: a saved choice, otherwise follow the system. */
export function useTheme(): Theme {
  const [pref, setPrefState] = useState<ThemePref>(() => (localStorage.getItem('wn_theme') as ThemePref) || 'auto');
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const effective: 'light' | 'dark' = pref === 'auto' ? (systemDark ? 'dark' : 'light') : pref;
  useEffect(() => {
    document.documentElement.dataset.theme = effective;
    document.documentElement.classList.toggle('dark', effective === 'dark');
  }, [effective]);

  const setPref = (next: ThemePref) => {
    localStorage.setItem('wn_theme', next);
    setPrefState(next);
  };
  return { pref, effective, setPref };
}
