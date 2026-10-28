// $.state contract of claude-token-meter. Only the main register/core owner edits this file.
export type Level = 'good' | 'warn' | 'bad'

declare module 'claude-code' {
  interface PluginState {
    'claude-token-meter': {
      /** $.clock.now() of the last model response, for the cache-expiry countdown. */
      lastReplyAt: number
      /** Latest efficiency % (start load ÷ current context), 0 when unknown. */
      eff: number
      /** Latest context fill % of the model's real window, 0 when unknown. */
      ctxPercent: number
      /** Lowest alert step already announced this session (100 = none yet). */
      alertedStep: number
      /** Context tokens of the session's first response (the fixed start load), 0 until known. */
      startCtx: number
      /** Latest context tokens, and the model's real window ($.session.usage().context.window). */
      ctx: number
      window: number
    }
  }
}
