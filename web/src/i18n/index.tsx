// Two-language support (English and Vietnamese). English is the default and the
// reference: every existing test reads the English strings, so the English output of
// any function or component must stay exactly as it was before a string moved here.
//
// Usage in a component:
//   const STRINGS = defineStrings({ title: 'Cases' }, { title: 'Các vụ việc' })
//   const s = useStrings(STRINGS)        // s.title
// Usage in a pure function (model, formatter): add a last parameter
//   `lang: Lang = 'en'` and read `pick(STRINGS, lang)`.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export { variableLabel, TERMS_VI } from './terms'

export type Lang = 'en' | 'vi'

export const LANGS: { id: Lang; label: string; name: string }[] = [
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'vi', label: 'VI', name: 'Tiếng Việt' },
]

export interface Strings<T> {
  en: T
  vi: T
}

/** Pairs an English table with a Vietnamese table of the same shape. */
export function defineStrings<T>(en: T, vi: T): Strings<T> {
  return { en, vi }
}

export function pick<T>(table: Strings<T>, lang: Lang): T {
  return lang === 'vi' ? table.vi : table.en
}

const STORAGE_KEY = 'earthpulse.lang'

export function readStoredLang(): Lang {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'vi' ? 'vi' : 'en'
  } catch {
    return 'en'
  }
}

interface LangContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
}

// Without a provider (unit tests that render one component) the language is English.
const LangContext = createContext<LangContextValue>({ lang: 'en', setLang: () => {} })

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang)

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, next)
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  return useContext(LangContext)
}

export function useStrings<T>(table: Strings<T>): T {
  return pick(table, useContext(LangContext).lang)
}
