import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import type { Level } from '../types'
import type { Config } from './core/config'
import { defineStrings } from './core/i18n'
import { PANE_CHECK, PANE_EFF } from './core/ids'

// Row above the prompt: efficiency badge, context % of the real window, cache-expiry countdown,
// and buttons opening the two panes. Reads state only (render hooks never write).

const effState = atom({ plugin: 'claude-token-meter', key: 'eff' } as const, 0)
const ctxPercentState = atom({ plugin: 'claude-token-meter', key: 'ctxPercent' } as const, 0)
const ctxState = atom({ plugin: 'claude-token-meter', key: 'ctx' } as const, 0)
const windowState = atom({ plugin: 'claude-token-meter', key: 'window' } as const, 0)
const lastReplyAt = atom({ plugin: 'claude-token-meter', key: 'lastReplyAt' } as const, 0)

const t = defineStrings({
  en: {
    eff: '📊 Efficiency {dot} {eff}%',
    effNone: '📊 Token efficiency',
    ctx: 'context {pct}% of {window}',
    cacheLeft: '⏱ cache {min} min',
    cacheGone: '⏱ cache expired',
    check: '🔌 Token check',
    effTitle: 'Token efficiency',
    checkTitle: 'Token & tool check',
  },
  ko: {
    eff: '📊 효율 {dot} {eff}%',
    effNone: '📊 토큰 효율',
    ctx: '컨텍스트 {pct}% / {window}',
    cacheLeft: '⏱ 캐시 {min}분',
    cacheGone: '⏱ 캐시 만료',
    check: '🔌 도구 점검',
    effTitle: '토큰 효율',
    checkTitle: '토큰·도구 점검',
  },
})

const LEVEL_DOT: Record<Level, string> = { good: '🟢', warn: '🟠', bad: '🔴' }
const LEVEL_COLOR: Record<Level, string> = { good: 'green', warn: 'yellow', bad: 'red' }

/** How often the band redraws so the countdown stays current (alert.ts starts the timer at session.start: one session.start hook per file pair). */
export const TICK_MS = 30000

// ---- pure helpers (exported for tests) ----

/** Level of an efficiency %: red below effWarn, orange below effCaution, green otherwise. */
export const levelOf = (eff: number, cfg: Pick<Config, 'effWarn' | 'effCaution'>): Level =>
  eff < cfg.effWarn ? 'bad' : eff < cfg.effCaution ? 'warn' : 'good'

/** Whole minutes of prompt cache left (rounded up), 0 when expired, null before the first reply. */
export function cacheLeftMin(nowMs: number, lastAt: number, ttlMin: number): number | null {
  if (lastAt <= 0) return null
  const left = ttlMin * 60000 - (nowMs - lastAt)
  return left > 0 ? Math.ceil(left / 60000) : 0
}

/** 1000000 → "1M", 200000 → "200k". */
export const fmtWindow = (n: number): string =>
  n >= 1000000 ? `${+(n / 1000000).toFixed(1)}M` : `${Math.round(n / 1000)}k`

export function installBand(on: On, cfg: Config): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const eff = await read($, effState)
    const ctx = await read($, ctxState)
    const window = await read($, windowState)
    const lastAt = await read($, lastReplyAt)
    if (eff <= 0 && ctx <= 0 && lastAt <= 0) return next(e)

    const pct = (await read($, ctxPercentState)) || (window > 0 ? Math.round((ctx * 100) / window) : 0)
    const left = cacheLeftMin(await $.clock.now(), lastAt, cfg.cacheTtlMin)
    const level = levelOf(eff, cfg)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Button
          key="eff"
          label={eff > 0 ? t('eff', { dot: LEVEL_DOT[level], eff }) : t('effNone')}
          onPress={() => void $.ui.open({ id: PANE_EFF, title: t('effTitle') })}
        />
        <Button key="check" label={t('check')} onPress={() => void $.ui.open({ id: PANE_CHECK, title: t('checkTitle') })} />
        {window > 0 && ctx > 0 && (
          <Text color={eff > 0 ? LEVEL_COLOR[level] : undefined}> {t('ctx', { pct, window: fmtWindow(window) })}</Text>
        )}
        {left !== null && (
          <Text dimColor={left > 0} color={left > 0 ? undefined : 'red'}>
            {' '}
            {left > 0 ? t('cacheLeft', { min: left }) : t('cacheGone')}
          </Text>
        )}
      </Box>
    )
  })
}
