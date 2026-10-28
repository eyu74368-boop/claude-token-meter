import type { LangSetting } from './config'

export type Lang = 'en' | 'ko'

let current: Lang = 'en'

export const lang = (): Lang => current

/** Maps Claude's `language` setting ("korean", "Korean", "한국어", "ko", "english", …) to a supported Lang; English otherwise. */
export function langOf(setting: unknown): Lang {
  if (typeof setting !== 'string') return 'en'
  return /^\s*(ko|kor|korean|한국)/i.test(setting) ? 'ko' : 'en'
}

/**
 * Sets the active language from the mod option, or from Claude's `language` setting when the
 * option is `auto`. register.tsx reads `$.settings.read({ key: 'language' })` and passes it here.
 */
export function setLang(setting: LangSetting, claudeLanguage: unknown): Lang {
  current = setting === 'auto' ? langOf(claudeLanguage) : setting
  return current
}

export type Vars = Record<string, string | number>

const fill = (text: string, vars?: Vars): string =>
  vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text

/**
 * Each file keeps its own table, so files can be written independently:
 *   const t = defineStrings({ en: { hi: 'Hi {name}' }, ko: { hi: '{name}님 안녕' } })
 *   t('hi', { name })
 * The `ko` table must have every key of `en` (checked by the type).
 */
export function defineStrings<K extends string>(table: { en: Record<K, string>; ko: Record<K, string> }) {
  return (key: K, vars?: Vars): string => fill(table[current][key] ?? table.en[key], vars)
}
