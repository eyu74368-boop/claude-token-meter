import type { PluginOptions } from 'claude-code'

export type LangSetting = 'auto' | 'en' | 'ko'

export type Config = {
  /** Efficiency % below which the level is red. */
  effWarn: number
  /** Efficiency % below which the level is orange. */
  effCaution: number
  /** Efficiency % levels, high to low; an alert fires the first time efficiency drops below each. */
  alertSteps: number[]
  /** Context growth per turn (tokens) above which a turn is logged as waste. */
  wasteTokens: number
  /** Prompt cache lifetime in minutes. */
  cacheTtlMin: number
  /** Conversation part (tokens) below which the cache-expiry alert is skipped. */
  cacheMinChat: number
  /** First-response input (tokens) above which the start load counts as heavy. */
  startPayload: number
  /** Log rows older than this many days are trimmed. */
  keepDays: number
  language: LangSetting
}

export const DEFAULTS: Config = {
  effWarn: 40,
  effCaution: 50,
  alertSteps: [40, 30, 22],
  wasteTokens: 15000,
  cacheTtlMin: 60,
  cacheMinChat: 40000,
  startPayload: 60000,
  keepDays: 30,
  language: 'auto',
}

const num = (v: unknown, fallback: number, min = 0): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback

export function parseSteps(v: unknown, fallback: number[]): number[] {
  if (typeof v !== 'string') return fallback
  const steps = v
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0 && n < 100)
  return steps.length > 0 ? [...new Set(steps)].sort((a, b) => b - a) : fallback
}

export function readConfig(options: PluginOptions): Config {
  const lang = options.language
  const effWarn = num(options.effWarn, DEFAULTS.effWarn)
  return {
    effWarn,
    effCaution: Math.max(effWarn, num(options.effCaution, DEFAULTS.effCaution)),
    alertSteps: parseSteps(options.alertSteps, DEFAULTS.alertSteps),
    wasteTokens: num(options.wasteTokens, DEFAULTS.wasteTokens, 1),
    cacheTtlMin: num(options.cacheTtlMin, DEFAULTS.cacheTtlMin, 1),
    cacheMinChat: num(options.cacheMinChat, DEFAULTS.cacheMinChat),
    startPayload: num(options.startPayload, DEFAULTS.startPayload, 1),
    keepDays: num(options.keepDays, DEFAULTS.keepDays, 1),
    language: lang === 'en' || lang === 'ko' ? lang : 'auto',
  }
}
