import type { On } from 'claude-code'

import type { Config } from '../core/config'
import { defineStrings } from '../core/i18n'
import { CMD_CHECK, PANE_CHECK } from '../core/ids'
import { claudeDirOf, join } from '../core/store'
import {
  aggregatePast,
  callsTo,
  callsToPlugin,
  catLabel,
  connTok,
  describe,
  fixedLoad,
  fixedRows,
  isUseRecord,
  k,
  listPlugins,
  pastFor,
  pastTip,
  pct,
  plainServers,
  pluginTokens,
  sameServer,
  serverTokens,
  staleSessions,
  toCounts,
  usedEntry,
  withPlugins,
} from './check-core'
import type { Bd, Conn, Past, Plug, UseRecord } from './check-core'

// Token & tool check pane: what is loaded (connectors, MCP servers, plugins, fixed start load),
// what this session actually used, past use, and on/off buttons.

const t = defineStrings({
  en: {
    title: 'Token & tool check',
    cmdDesc: 'Show loaded connectors, MCP servers and plugins with their token cost',
    opened: 'Token & tool check pane opened.',
    tokens: 'Tokens',
    ctxLine: 'Context {ctx}{win} · cost ${usd}',
    limits: 'Usage limits: {list}',
    fixed: 'Fixed start load: {n} tokens (reloaded in every new session)',
    fixedHead: 'Start load',
    unused: 'Loaded but unused: about {n} tokens; turning it off saves that much on every request from the next session',
    offIdle: 'Turn off everything unused (connectors {c} · plugins {p})',
    noIdle: 'No connector or plugin is on and unused',
    connectors: 'Connectors',
    servers: 'MCP servers',
    plugins: 'Plugins',
    loading: 'Loading…',
    askConn: 'Ask Claude for the connector status',
    askConnText: 'Show the connector status (session_connectors_status) as a short table, marking the ones on but unused in this session.',
    allOff: 'Turn all off',
    hName: 'Name (open for details)',
    hState: 'State',
    hTok: 'Tokens now',
    hPast: 'Past use',
    on: 'on',
    off: 'off',
    turnOn: 'Turn on',
    turnOff: 'Turn off',
    used: '● used {n}×',
    onIdle: '● on, unused',
    idle: '● unused',
    isOff: '○ off',
    offLoaded: '○ off (loaded)',
    deferred: ' +deferred {n}',
    ifOn: 'about {n} if on',
    skillsPart: ' (skills {n})',
    pastCell: '{s} sessions {c}×',
    showQuiet: '▸ Show {n} off and unused',
    hideQuiet: '▾ Hide {n} off and unused',
    showOff: '▸ Show {n} off',
    hideOff: '▾ Hide {n} off',
    offTok: ' {n} loaded this session; gone from the next session',
    offNone: ' not loaded',
    pluginServers: '{n} servers come from plugins ({c} connected); turning the plugin off removes them from the next session',
    plugNote: 'Plugin changes apply from the next session',
    plugFail: 'Could not read or write settings.json; plugins unchanged',
    plugNone: 'No plugins found',
    connDone: '{name} turned {state}; applies from the next turn',
    connAllDone: '{n} connectors turned {state}; applies from the next turn',
    connNothing: 'No connector to change (all already {state})',
    connAsk: 'Turn {state} connector {names} (set_session_connector_enabled). Do nothing else.',
    plugDone: '{names} turned {state}; applies from the next session',
    idleDone: 'Turned off unused: {c} connectors · {p} plugins',
    refresh: '↻ Refresh',
    noServers: 'No MCP server loaded',
    noBreakdown: 'Context breakdown unavailable',
  },
  ko: {
    title: '토큰·도구 점검',
    cmdDesc: '실린 커넥터·MCP 서버·플러그인과 토큰 비용 보기',
    opened: '토큰·도구 점검 창을 열었어요.',
    tokens: '토큰',
    ctxLine: '컨텍스트 {ctx}{win} · 누적 ${usd}',
    limits: '사용 한도: {list}',
    fixed: '고정 시작 짐: {n} 토큰 (새 세션마다 다시 실림)',
    fixedHead: '시작 짐 구성',
    unused: '안 쓰는데 실려 있는 것: 약 {n} 토큰 — 끄면 다음 세션부터 매 요청 그만큼 덜 읽어요',
    offIdle: '안 쓰는 것 한 번에 끄기 (커넥터 {c} · 플러그인 {p})',
    noIdle: '켜져 있는데 안 쓰는 커넥터·플러그인 없음',
    connectors: '커넥터',
    servers: 'MCP 서버',
    plugins: '플러그인',
    loading: '읽는 중…',
    askConn: '커넥터 상태를 Claude에게 묻기',
    askConnText: '커넥터 상태(session_connectors_status)를 짧은 표로 보여줘. 켜진 것 중 이 세션에서 안 쓴 것 표시.',
    allOff: '전체 끄기',
    hName: '이름 (누르면 설명)',
    hState: '상태',
    hTok: '이 세션 토큰',
    hPast: '지난 사용',
    on: '켜',
    off: '꺼',
    turnOn: '켜기',
    turnOff: '끄기',
    used: '● 씀 {n}번',
    onIdle: '● 켜짐·안 씀',
    idle: '● 안 씀',
    isOff: '○ 꺼짐',
    offLoaded: '○ 꺼짐(실림)',
    deferred: ' +대기 {n}',
    ifOn: '켜면 약 {n}',
    skillsPart: ' (스킬 {n})',
    pastCell: '{s}세션 {c}번',
    showQuiet: '▸ 꺼진 채 안 쓰는 것 {n}개 보기',
    hideQuiet: '▾ 꺼진 채 안 쓰는 것 {n}개 접기',
    showOff: '▸ 꺼진 것 {n}개 보기',
    hideOff: '▾ 꺼진 것 {n}개 접기',
    offTok: ' 이 세션엔 {n} 실림 — 다음 세션부터 빠짐',
    offNone: ' 안 실림',
    pluginServers: '플러그인이 올린 서버 {n}개(연결 {c}) — 플러그인을 끄면 다음 세션부터 빠져요',
    plugNote: '플러그인 켜고 끄기는 다음 세션부터 적용',
    plugFail: 'settings.json을 읽거나 쓰지 못해 플러그인을 바꾸지 않았어요',
    plugNone: '플러그인 없음',
    connDone: '{name} {state}짐 — 다음 턴부터 적용',
    connAllDone: '커넥터 {n}개 {state}짐 — 다음 턴부터 적용',
    connNothing: '바꿀 커넥터가 없어요(이미 전부 {state}짐)',
    connAsk: '커넥터 {names} {state}줘 (set_session_connector_enabled). 다른 일은 하지 마.',
    plugDone: '{names} {state}짐 — 다음 세션부터 적용',
    idleDone: '안 쓰는 것 끔: 커넥터 {c}개 · 플러그인 {p}개',
    refresh: '↻ 새로고침',
    noServers: '실린 MCP 서버 없음',
    noBreakdown: '컨텍스트 구성을 읽지 못했어요',
  },
})

const TOOLS = 'check:tools:'
const TOK = 'check:tok:'

// What the pane has read (null = not yet, undefined = could not). Refresh reads again.
let conns: Conn[] | undefined | null = null
let plugs: Plug[] | undefined | null = null
let bd: Bd | undefined
let past = new Map<string, Past>()
let note = ''
let openTip = ''
const showOff = new Set<string>()
let isLoading = false

// Tool calls of the live sessions, flushed to $.store at turn end.
const usedNow = new Map<string, Map<string, number>>()
const usedDirty = new Set<string>()

const mcpText = (r: { content: { type: string; text?: string }[] }): string =>
  r.content.map(c => (c.type === 'text' ? (c.text ?? '') : '')).join('')

type Manifest = { plugins?: { name?: unknown; description?: unknown }[] }

async function homeOf($: any): Promise<string> {
  return (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '.'
}

async function sessionId($: any): Promise<string> {
  try {
    return String(await $.session.id())
  } catch {
    return ''
  }
}

async function noteUsed($: any, id: string, entry: string) {
  let counts = usedNow.get(id)
  if (!counts) {
    const v = await $.store.get(TOOLS + id)
    counts = toCounts(isUseRecord(v) ? v.counts : undefined)
    usedNow.set(id, counts)
  }
  counts.set(entry, (counts.get(entry) ?? 0) + 1)
  usedDirty.add(id)
}

async function flushUsed($: any, id: string) {
  if (!usedDirty.has(id)) return
  usedDirty.delete(id)
  const map = usedNow.get(id) ?? new Map<string, number>()
  const now = Number(await $.clock.now())
  const rec: UseRecord = { at: Number.isFinite(now) ? now : 0, counts: Object.fromEntries(map) }
  await $.store.set(TOOLS + id, rec)
}

async function storedRecords($: any): Promise<[string, UseRecord][]> {
  const out: [string, UseRecord][] = []
  for (const key of (await $.store.keys()) as string[]) {
    if (!key.startsWith(TOOLS)) continue
    const v = await $.store.get(key)
    if (isUseRecord(v)) out.push([key.slice(TOOLS.length), v])
  }
  return out
}

async function prune($: any, keepDays: number) {
  const now = Number(await $.clock.now())
  for (const id of staleSessions(await storedRecords($), now, keepDays)) await $.store.delete(TOOLS + id)
}

async function readConnectors($: any): Promise<Conn[] | undefined> {
  try {
    const r = await $.mcp.call('ccd_connectors', 'session_connectors_status', {})
    if (r.isError) return undefined
    const v = JSON.parse(mcpText(r))
    return Array.isArray(v?.servers) ? (v.servers as Conn[]) : undefined
  } catch {
    return undefined
  }
}

async function readJson($: any, path: string): Promise<unknown> {
  try {
    return JSON.parse(String(await $.fs.read(path)))
  } catch {
    return undefined
  }
}

async function readPlugins($: any): Promise<Plug[] | undefined> {
  try {
    const plugDir = join(claudeDirOf(await homeOf($)), 'plugins')
    const enabled = await $.settings.read({ key: 'enabledPlugins' })
    const installed = (await readJson($, join(plugDir, 'installed_plugins.json'))) as { plugins?: Record<string, unknown> } | undefined
    const synced: Manifest[] = []
    const syncDir = join(plugDir, 'synced')
    if (await $.fs.exists(syncDir)) {
      for (const f of (await $.fs.list(syncDir)) as { name: string; kind: string }[]) {
        if (f.kind !== 'directory') continue
        const m = await readJson($, join(syncDir, f.name, 'manifest.json'))
        if (m && typeof m === 'object') synced.push(m as Manifest)
      }
    }
    return listPlugins(enabled, installed, synced, String($.plugin.name))
  } catch {
    return undefined
  }
}

async function readBreakdown($: any): Promise<Bd | undefined> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    return (u.context.breakdown as Bd | undefined) ?? undefined
  } catch {
    return undefined
  }
}

// Reads everything; `remember` also stores the tokens seen while a connector was on (never from render).
async function refresh($: any, remember: boolean) {
  if (isLoading) return
  isLoading = true
  try {
    conns = await readConnectors($)
    plugs = await readPlugins($)
    bd = await readBreakdown($)
    const id = await sessionId($)
    past = aggregatePast((await storedRecords($)).filter(([sid]) => sid !== id).map(([, r]) => r))
    if (remember) {
      const st = serverTokens(bd)
      for (const c of conns ?? []) {
        const tok = connTok(st, c.name, c.id)
        if (tok && tok.loaded + tok.deferred > 0) await $.store.set(TOK + c.name, tok.loaded + tok.deferred)
      }
    }
  } catch {
    // Keep what was read; the next refresh tries again.
  } finally {
    isLoading = false
  }
  $.ui.invalidate('ui.render')
}

function toggleTip($: any, key: string) {
  openTip = openTip === key ? '' : key
  $.ui.invalidate('ui.render')
}

function toggleOff($: any, sec: string) {
  if (showOff.has(sec)) showOff.delete(sec)
  else showOff.add(sec)
  $.ui.invalidate('ui.render')
}

async function toggleConn($: any, c: Conn, enabled: boolean): Promise<boolean> {
  try {
    const r = await $.mcp.call('ccd_connectors', 'set_session_connector_enabled', { connector: c.id ?? c.name, enabled })
    return !r.isError
  } catch {
    return false
  }
}

// When the app refuses the mod's direct call, ask Claude in one line instead.
function askConn($: any, names: string[], enabled: boolean) {
  void $.prompt.submit({ text: t('connAsk', { names: names.join(', '), state: enabled ? t('on') : t('off') }), asUser: true })
}

async function switchConn($: any, c: Conn, enabled: boolean) {
  note = ''
  if (await toggleConn($, c, enabled)) {
    note = t('connDone', { name: c.name, state: enabled ? t('on') : t('off') })
    await refresh($, true)
  } else askConn($, [c.name], enabled)
}

async function switchAllConn($: any, enabled: boolean) {
  note = ''
  const targets = (conns ?? []).filter(c => c.kind === 'connector' && (c.status !== 'disabled') !== enabled)
  if (targets.length === 0) {
    note = t('connNothing', { state: enabled ? t('on') : t('off') })
    $.ui.invalidate('ui.render')
    return
  }
  const failed: string[] = []
  for (const c of targets) if (!(await toggleConn($, c, enabled))) failed.push(c.name)
  if (failed.length) askConn($, failed, enabled)
  note = t('connAllDone', { n: targets.length - failed.length, state: enabled ? t('on') : t('off') })
  await refresh($, true)
}

// Plugins: no API writes `enabledPlugins`, so the user settings.json is edited in place.
async function setPlugins($: any, keys: string[], isOn: boolean): Promise<boolean> {
  if (keys.length === 0) return true
  try {
    const path = join(claudeDirOf(await homeOf($)), 'settings.json')
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const text = withPlugins(old, keys, isOn)
    if (text === undefined) return false
    await $.fs.write(path, text)
    return true
  } catch {
    return false
  }
}

async function switchPlugs($: any, ps: Plug[], isOn: boolean) {
  const ok = await setPlugins($, ps.map(p => p.key), isOn)
  note = ok ? t('plugDone', { names: ps.map(p => p.name).join(', '), state: isOn ? t('on') : t('off') }) : t('plugFail')
  await refresh($, true)
}

async function offUnused($: any, cs: Conn[], ps: Plug[]) {
  const failed: string[] = []
  for (const c of cs) if (!(await toggleConn($, c, false))) failed.push(c.name)
  const ok = await setPlugins($, ps.map(p => p.key), false)
  if (failed.length) askConn($, failed, false)
  note = ok ? t('idleDone', { c: cs.length - failed.length, p: ps.length }) : t('plugFail')
  await refresh($, true)
}

export function installCheck(on: On, cfg: Config): void {
  // Matchers that match every event: a module allows one unmatched hook per event (register.tsx holds it).
  on('session.start', { cwd: /./ }, async ($, e, next) => {
    try {
      await $.command.register({ name: CMD_CHECK, description: t('cmdDesc') })
      await prune($, cfg.keepDays)
    } catch {
      // A missing command or a failed prune never blocks the session.
    }
    return next(e)
  })

  on('command.run', { command: CMD_CHECK }, async $ => {
    void refresh($, true)
    await $.ui.open({ id: PANE_CHECK, title: t('title') })
    return { text: t('opened') }
  })

  // Every tool call counts as used by this session (sub-agents' calls included).
  on('tool.call', { tool: /./ }, async ($, e, next) => {
    try {
      const id = await sessionId($)
      if (id) await noteUsed($, id, usedEntry(e as unknown as { tool: string; skill?: unknown; subagent_type?: unknown }))
    } catch {
      // Counting never blocks a tool call.
    }
    return next(e)
  })

  on('turn.complete', { reason: /./ }, async ($, e, next) => {
    try {
      const id = await sessionId($)
      if (id) await flushUsed($, id)
      if (conns !== null) await refresh($, true)
    } catch {
      // Ignore: the next turn flushes again.
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_CHECK }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    if (conns === null && !isLoading) void refresh($, false)
    const id = await sessionId($)
    let ctx = 0
    let win = 0
    let usd = 0
    let limits = ''
    try {
      const usage = await $.session.usage()
      ctx = usage.context.tokens ?? 0
      win = usage.context.window ?? 0
      usd = usage.cost?.usd ?? 0
      limits = (usage.rateLimits ?? []).map(r => `${r.kind} ${Math.round(r.percentUsed)}%`).join(' · ')
    } catch {
      // Usage unavailable: the header shows zeros.
    }
    const stored = id ? await $.store.get(TOOLS + id) : undefined
    const nowCounts = usedNow.get(id) ?? toCounts(isUseRecord(stored) ? stored.counts : undefined)
    const st = serverTokens(bd)
    const fixed = fixedLoad(bd)

    const connectors = (conns ?? []).filter(c => c.kind === 'connector')
    const pluginServers = (conns ?? []).filter(c => c.kind === 'plugin')
    const servers = plainServers(st).filter(s => !connectors.some(c => sameServer(s, c.name, c.id)))
    const remembered: Record<string, number> = {}
    for (const c of connectors) {
      const v = await $.store.get(TOK + c.name)
      if (typeof v === 'number') remembered[c.name] = v
    }
    const plugList = plugs ?? []
    const plugToks = new Map(plugList.map(p => [p.key, pluginTokens(bd, p.name)]))
    const tokOf = (p: Plug) => plugToks.get(p.key)?.total ?? 0
    const unusedTok =
      connectors.reduce((a, c) => {
        const tok = connTok(st, c.name, c.id)
        return a + (c.status !== 'disabled' && tok && !callsTo(nowCounts, c.name, c.id) ? tok.loaded : 0)
      }, 0) +
      servers.reduce((a, s) => a + (callsTo(nowCounts, s) ? 0 : (st.get(s)?.loaded ?? 0)), 0) +
      plugList.reduce((a, p) => a + (callsToPlugin(nowCounts, p.name) ? 0 : tokOf(p)), 0)
    const connQuiet = connectors.filter(c => c.status === 'disabled' && !remembered[c.name] && !pastFor(past, c.name, c.id))
    const plugQuiet = plugList.filter(p => !p.isOn)
    const plugQuietTok = plugQuiet.reduce((a, p) => a + tokOf(p), 0)
    const idleConns = connectors.filter(c => c.status !== 'disabled' && !callsTo(nowCounts, c.name, c.id))
    const idlePlugs = plugList.filter(p => p.isOn && !callsToPlugin(nowCounts, p.name))
    const pastCell = (p: Past | undefined) => (p ? t('pastCell', { s: p.sessions, c: p.calls }) : '-')
    const tokCell = (tok: { loaded: number; deferred: number } | undefined) =>
      tok ? `${k(tok.loaded)}${tok.deferred ? t('deferred', { n: k(tok.deferred) }) : ''}` : '-'
    const nameButton = (key: string, name: string) => (
      <Button key={`${key}-n`} label={`${openTip === key ? '▾' : '▸'} ${name}`} onPress={() => toggleTip($, key)} />
    )

    return (
      <Box flexDirection="column">
        <Text bold>{t('tokens')}</Text>
        <Text>{t('ctxLine', { ctx: k(ctx), win: win ? ` / ${k(win)} (${pct(ctx, win)}%)` : '', usd: usd.toFixed(2) })}</Text>
        {limits ? <Text dimColor>{t('limits', { list: limits })}</Text> : null}
        {fixed ? <Text>{t('fixed', { n: k(fixed) })}</Text> : null}
        {bd ? (
          <Text color={unusedTok >= 5000 ? 'yellow' : undefined}>{t('unused', { n: k(unusedTok) })}</Text>
        ) : conns === null ? null : (
          <Text dimColor>{t('noBreakdown')}</Text>
        )}
        {idleConns.length + idlePlugs.length > 0 ? (
          <Button key="off-idle" label={t('offIdle', { c: idleConns.length, p: idlePlugs.length })} onPress={() => void offUnused($, idleConns, idlePlugs)} />
        ) : conns === null ? null : (
          <Text color="green">{t('noIdle')}</Text>
        )}

        {fixed ? (
          <Box key="fixed" flexDirection="column">
            <Button key="fixed-b" label={`${showOff.has('fixed') ? '▾' : '▸'} ${t('fixedHead')}`} onPress={() => toggleOff($, 'fixed')} />
            {showOff.has('fixed')
              ? fixedRows(bd).map(r => {
                  const { label, desc } = catLabel(r.name)
                  return (
                    <Box key={`cat-${r.name}`} paddingLeft={2}>
                      <Box width={24}><Text>{label}</Text></Box>
                      <Box width={10}><Text>{k(r.tokens)}</Text></Box>
                      <Text dimColor>{desc}</Text>
                    </Box>
                  )
                })
              : null}
          </Box>
        ) : null}

        {conns === null ? <Text dimColor>{t('loading')}</Text> : null}

        {connectors.length > 0 ? <Text bold>{t('connectors')}</Text> : null}
        {conns === undefined ? (
          <Button key="ask-conn" label={t('askConn')} onPress={() => void $.prompt.submit({ text: t('askConnText'), asUser: true })} />
        ) : null}
        {connectors.length > 0 ? (
          <Box key="conn-h">
            <Box width={10}><Button key="conn-all-off" label={t('allOff')} onPress={() => void switchAllConn($, false)} /></Box>
            <Box width={30}><Text dimColor>{t('hName')}</Text></Box>
            <Box width={16}><Text dimColor>{t('hState')}</Text></Box>
            <Box width={18}><Text dimColor>{t('hTok')}</Text></Box>
            <Text dimColor>{t('hPast')}</Text>
          </Box>
        ) : null}
        {connectors.map(c => {
          const isOn = c.status !== 'disabled'
          const n = callsTo(nowCounts, c.name, c.id)
          const tok = connTok(st, c.name, c.id)
          const p = pastFor(past, c.name, c.id)
          if (!isOn && !remembered[c.name] && !p && !showOff.has('conn')) return null
          const key = `c-${c.name}`
          const state = isOn ? (n ? t('used', { n }) : t('onIdle')) : t('isOff')
          const mem = remembered[c.name]
          const tokText = isOn ? (tok ? tokCell(tok) : c.status === 'connected' ? '-' : c.status) : mem ? t('ifOn', { n: k(mem) }) : '-'
          return (
            <Box key={key} flexDirection="column">
              <Box key={`${key}-r`}>
                <Box width={10}><Button key={`${key}-t`} label={isOn ? t('turnOff') : t('turnOn')} onPress={() => void switchConn($, c, !isOn)} /></Box>
                <Box width={30}>{nameButton(key, c.name)}</Box>
                <Box width={16}><Text color={isOn ? (n ? 'green' : 'yellow') : undefined} dimColor={!isOn}>{state}</Text></Box>
                <Box width={18}><Text dimColor={!isOn}>{tokText}</Text></Box>
                <Text dimColor>{pastCell(p)}</Text>
              </Box>
              {openTip === key ? <Box key={`${key}-d`} paddingLeft={10}><Text color="cyan">{pastTip(describe(c.name), p, n)}</Text></Box> : null}
            </Box>
          )
        })}
        {connQuiet.length > 0 ? (
          <Box key="conn-off" flexWrap="wrap">
            <Button
              key="conn-off-b"
              label={showOff.has('conn') ? t('hideQuiet', { n: connQuiet.length }) : t('showQuiet', { n: connQuiet.length })}
              onPress={() => toggleOff($, 'conn')}
            />
            {showOff.has('conn') ? null : <Text dimColor> {connQuiet.map(c => c.name).join(', ')}</Text>}
          </Box>
        ) : null}

        <Text bold>{t('servers')}</Text>
        {bd && servers.length === 0 ? <Text dimColor>{t('noServers')}</Text> : null}
        {servers.map(s => {
          const tok = st.get(s)
          const n = callsTo(nowCounts, s)
          const p = pastFor(past, s)
          const key = `s-${s}`
          return (
            <Box key={key} flexDirection="column">
              <Box key={`${key}-r`}>
                <Box width={10}><Text dimColor> </Text></Box>
                <Box width={30}>{nameButton(key, s)}</Box>
                <Box width={16}><Text color={n ? 'green' : tok?.loaded ? 'yellow' : undefined}>{n ? t('used', { n }) : t('idle')}</Text></Box>
                <Box width={18}><Text>{tokCell(tok)}</Text></Box>
                <Text dimColor>{pastCell(p)}</Text>
              </Box>
              {openTip === key ? <Box key={`${key}-d`} paddingLeft={10}><Text color="cyan">{pastTip(describe(s), p, n)}</Text></Box> : null}
            </Box>
          )
        })}
        {pluginServers.length > 0 ? (
          <Text dimColor>{t('pluginServers', { n: pluginServers.length, c: pluginServers.filter(c => c.status === 'connected').length })}</Text>
        ) : null}

        <Text bold>{t('plugins')}</Text>
        {plugs === null ? <Text dimColor>{t('loading')}</Text> : null}
        {plugs === undefined ? <Text dimColor>{t('plugFail')}</Text> : null}
        {plugs && plugList.length === 0 ? <Text dimColor>{t('plugNone')}</Text> : null}
        {plugList.length > 0 ? (
          <Box key="plug-all">
            {plugList.some(p => p.isOn) ? (
              <Button key="plug-all-off" label={t('allOff')} onPress={() => void switchPlugs($, plugList.filter(p => p.isOn), false)} />
            ) : null}
            <Text dimColor> {t('plugNote')}</Text>
          </Box>
        ) : null}
        {[...plugList]
          .sort((a, b) => Number(b.isOn) - Number(a.isOn) || tokOf(b) - tokOf(a))
          .map(p => {
            const tok = plugToks.get(p.key) ?? { skills: 0, tools: 0, agents: 0, total: 0 }
            const n = callsToPlugin(nowCounts, p.name)
            const pp = past.get(`plugin:${p.name}`)
            if (!p.isOn && !showOff.has('plug')) return null
            const key = `p-${p.key}`
            const state = p.isOn ? (n ? t('used', { n }) : t('onIdle')) : tok.total ? t('offLoaded') : t('isOff')
            const tokText = tok.total ? `${k(tok.total)}${tok.skills && tok.skills !== tok.total ? t('skillsPart', { n: k(tok.skills) }) : ''}` : '-'
            return (
              <Box key={key} flexDirection="column">
                <Box key={`${key}-r`}>
                  <Box width={10}><Button key={`${key}-t`} label={p.isOn ? t('turnOff') : t('turnOn')} onPress={() => void switchPlugs($, [p], !p.isOn)} /></Box>
                  <Box width={30}>{nameButton(key, p.name)}</Box>
                  <Box width={16}><Text color={n ? 'green' : tok.total ? 'yellow' : undefined} dimColor={!p.isOn && !tok.total}>{state}</Text></Box>
                  <Box width={18}><Text dimColor={!tok.total}>{tokText}</Text></Box>
                  <Text dimColor>{pastCell(pp)}</Text>
                </Box>
                {openTip === key ? <Box key={`${key}-d`} paddingLeft={10}><Text color="cyan">{pastTip(p.desc ?? describe(p.name), pp, n)}</Text></Box> : null}
              </Box>
            )
          })}
        {plugQuiet.length > 0 ? (
          <Box key="plug-off" flexWrap="wrap">
            <Button
              key="plug-off-b"
              label={showOff.has('plug') ? t('hideOff', { n: plugQuiet.length }) : t('showOff', { n: plugQuiet.length })}
              onPress={() => toggleOff($, 'plug')}
            />
            {showOff.has('plug') ? null : <Text dimColor>{plugQuietTok ? t('offTok', { n: k(plugQuietTok) }) : t('offNone')}</Text>}
          </Box>
        ) : null}

        {note ? <Text color="green">{note}</Text> : null}
        <Button key="refresh" label={t('refresh')} onPress={() => void refresh($, true)} />
      </Box>
    )
  })
}
