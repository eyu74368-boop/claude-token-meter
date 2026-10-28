import { expect, mock, test } from 'claude-code/testing'

import { cacheLeftMin, fmtWindow, levelOf } from '../hooks/band'
import { DEFAULTS } from '../hooks/core/config'

const BAND = {
  plugin: 'claude-token-meter',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

test('pure helpers: level colours, cache countdown, window size', () => {
  expect(levelOf(35, DEFAULTS)).toBe('bad')
  expect(levelOf(45, DEFAULTS)).toBe('warn')
  expect(levelOf(80, DEFAULTS)).toBe('good')
  expect(cacheLeftMin(0, 0, 60)).toBe(null)
  expect(cacheLeftMin(30 * 60000 + 1, 1, 60)).toBe(30)
  expect(cacheLeftMin(61 * 60000, 1, 60)).toBe(0)
  expect(fmtWindow(1000000)).toBe('1M')
  expect(fmtWindow(200000)).toBe('200k')
})

test('a fresh session leaves the band to the engine, on every surface', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/u' })
  on('settings.read', () => ({ value: {} as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.unmount()
  }
})
