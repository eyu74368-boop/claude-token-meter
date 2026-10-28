import { expect, test } from 'claude-code/testing'

import {
  aggregatePast,
  callsToPlugin,
  fixedLoad,
  listPlugins,
  pluginTokens,
  staleSessions,
  toCounts,
  usedEntry,
  withPlugins,
} from '../hooks/panes/check-core'
import type { Bd } from '../hooks/panes/check-core'

const PANE = {
  plugin: 'claude-token-meter',
  component: 'Pane',
  requestId: 'token-meter-check',
  props: {
    title: 'Token & tool check',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('the check pane draws its sections on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'token-check' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Tokens|토큰/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /MCP/ })) !== undefined).toBe(true)
    await ui.unmount()
  }
})

test('tool calls are named and grouped by server and plugin', async () => {
  expect(usedEntry({ tool: 'Skill', skill: 'engineering:debug' })).toBe('skill:engineering:debug')
  expect(usedEntry({ tool: 'Agent', subagent_type: 'Explore' })).toBe('agent:Explore')
  expect(usedEntry({ tool: 'Read' })).toBe('Read')
  expect(toCounts(['a', 'b']).get('a')).toBe(1)

  const past = aggregatePast([
    { at: 1000, counts: { 'mcp__github__list': 2, 'skill:design:critique': 1 } },
    { at: 2000, counts: { 'mcp__github__get': 1 } },
  ])
  expect(past.get('github')?.sessions).toBe(2)
  expect(past.get('github')?.calls).toBe(3)
  expect(past.get('github')?.last).toBe(2000)
  expect(past.get('plugin:design')?.calls).toBe(1)
  expect(callsToPlugin(new Map([['skill:design:critique', 3]]), 'design')).toBe(3)
})

test('old sessions are pruned by age and count', async () => {
  const day = 86400000
  const now = 100 * day
  const ids = staleSessions(
    [
      ['old', { at: now - 40 * day, counts: {} }],
      ['new', { at: now - day, counts: {} }],
      ['newer', { at: now, counts: {} }],
    ],
    now,
    30,
    1,
  )
  expect(ids.sort().join(',')).toBe('new,old')
})

test('plugins are listed from settings, installs and synced manifests, and toggled in settings.json', async () => {
  const plugs = listPlugins(
    { 'a@market': true, 'b@synced': false },
    { plugins: { 'a@market': [], 'c@market': [] } },
    [{ plugins: [{ name: 'b', description: 'B tools' }, { name: 'd' }] }],
    'self',
  )
  expect(plugs.map(p => `${p.key}=${p.isOn}`).join(' ')).toBe('a@market=true b@synced=false c@market=false d@synced=true')
  expect(plugs.find(p => p.name === 'b')?.desc).toBe('B tools')

  const text = withPlugins('{ "model": "x", "enabledPlugins": { "a@market": true } }', ['a@market', 'd@synced'], false)
  const v = JSON.parse(text ?? '{}')
  expect(v.model).toBe('x')
  expect(v.enabledPlugins['a@market']).toBe(false)
  expect(v.enabledPlugins['d@synced']).toBe(false)
  expect(withPlugins('not json', ['a'], true)).toBe(undefined)
})

test('plugin tokens and the fixed start load come from the breakdown', async () => {
  const bd: Bd = {
    categories: [
      { name: 'System prompt', tokens: 3000, kind: 'used' },
      { name: 'Messages', tokens: 9000, kind: 'used' },
      { name: 'Free space', tokens: 100000, kind: 'free' },
      { name: 'MCP tools (deferred)', tokens: 5000, kind: 'deferred' },
      { name: 'Skills', tokens: 1000, kind: 'used' },
    ],
    mcpTools: [{ name: 'mcp__plugin_design_figma__x', serverName: 'plugin:design:figma', tokens: 400, isLoaded: true }],
    skills: { tokens: 300, skillFrontmatter: [{ name: 'critique', pluginName: 'design', tokens: 300 }] },
    agents: [{ agentType: 'design:reviewer', tokens: 50 }],
  }
  expect(fixedLoad(bd)).toBe(4000)
  expect(pluginTokens(bd, 'design').total).toBe(750)
})
