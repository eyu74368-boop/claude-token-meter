import type { EngineInterface, Register } from 'claude-code'

import { installAlert } from './alert'
import { installBand } from './band'
import { readConfig, type LangSetting } from './core/config'
import { setLang } from './core/i18n'
import { installCheck } from './panes/check'
import { installEfficiency } from './panes/efficiency'

/** Re-reads Claude's `language` setting (no settings-change event exists, so callers poll it). */
async function refreshLang($: EngineInterface, setting: LangSetting): Promise<void> {
  let claudeLanguage: unknown
  try {
    claudeLanguage = await $.settings.read({ key: 'language' })
  } catch {
    claudeLanguage = undefined
  }
  setLang(setting, claudeLanguage)
}

// Wiring only: each feature lives in its own file and installs its own hooks.
export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  // Every hook carries an always-true matcher: an event may have only one unmatched hook per module.
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    await refreshLang($, cfg.language)
    return next(e)
  })

  // Registered before the features, so it runs first: a changed `language` setting applies from the next prompt.
  on('prompt.submit', { text: /^/ }, async ($, e, next) => {
    await refreshLang($, cfg.language)
    return next(e)
  })

  installEfficiency(on, cfg)
  installCheck(on, cfg)
  installAlert(on, cfg)
  installBand(on, cfg)
}
