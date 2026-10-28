// Pure helpers of the token & tool check pane: no `$`, no I/O.
import { defineStrings, lang } from '../core/i18n'

/** One tool's call count in one session, as kept in $.store. */
export type Counts = Record<string, number>
/** What the pane stores per session: when it was last written and the call counts. */
export type UseRecord = { at: number; counts: Counts }
export type Past = { sessions: number; calls: number; last: number; tools: Record<string, number> }
export type Conn = { name: string; id?: string; kind: string; status: string; tool_count?: number }
export type Plug = { key: string; name: string; isOn: boolean; desc?: string }
export type Tok = { loaded: number; deferred: number; count: number }

/** The parts of `context.breakdown` the pane reads. */
export type Bd = {
  categories: { name: string; tokens: number; kind?: string }[]
  mcpTools: { name: string; serverName: string; tokens: number; isLoaded: boolean }[]
  skills?: { tokens: number; skillFrontmatter: { name: string; pluginName?: string; tokens: number }[] }
  agents: { agentType: string; tokens: number }[]
}

export const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(Math.round(n)))
export const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) : 0)

/** Store value (old: name array, new: { name: count }) → count map. */
export function toCounts(v: unknown): Map<string, number> {
  if (Array.isArray(v)) return new Map(v.filter((x): x is string => typeof x === 'string').map(x => [x, 1]))
  if (v && typeof v === 'object') {
    return new Map(Object.entries(v as Record<string, unknown>).map(([a, b]) => [a, Number(b) || 1]))
  }
  return new Map()
}

/** Name to record: skills as skill:<name>, sub-agents as agent:<type>, everything else the tool name. */
export function usedEntry(e: { tool: string; skill?: unknown; subagent_type?: unknown }): string {
  if (e.tool === 'Skill' && typeof e.skill === 'string' && e.skill) return `skill:${e.skill}`
  if (e.tool === 'Agent' && typeof e.subagent_type === 'string' && e.subagent_type) return `agent:${e.subagent_type}`
  return e.tool
}

/** Tool name → group keys (MCP server prefix, plugin:<name>) and the short tool name. */
export function useKeys(tool: string): { keys: string[]; short: string } {
  const keys: string[] = []
  let short = tool
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) {
    keys.push(mcp[1]!)
    short = mcp[2]!
    const p = /^plugin_(.+)_[^_]+$/.exec(mcp[1]!)
    if (p) keys.push(`plugin:${p[1]!}`)
  }
  const named = /^(?:skill|agent):([^:]+):(.+)$/.exec(tool)
  if (named) {
    keys.push(`plugin:${named[1]!}`)
    short = named[2]!
  }
  return { keys, short }
}

export function aggregatePast(records: UseRecord[]): Map<string, Past> {
  const out = new Map<string, Past>()
  for (const r of records) {
    const seen = new Set<string>()
    for (const [tool, raw] of Object.entries(r.counts)) {
      const n = Number(raw) || 1
      const { keys, short } = useKeys(tool)
      for (const key of keys) {
        let p = out.get(key)
        if (!p) {
          p = { sessions: 0, calls: 0, last: 0, tools: {} }
          out.set(key, p)
        }
        p.calls += n
        p.tools[short] = (p.tools[short] ?? 0) + n
        if (!seen.has(key)) {
          seen.add(key)
          p.sessions += 1
          p.last = Math.max(p.last, r.at)
        }
      }
    }
  }
  return out
}

/** Which stored sessions to drop: older than keepDays, or beyond the newest `max`. */
export function staleSessions(records: [string, UseRecord][], nowMs: number, keepDays: number, max = 200): string[] {
  const cut = nowMs - keepDays * 86400000
  const sorted = [...records].sort((a, b) => b[1].at - a[1].at)
  return sorted.filter(([, r], i) => i >= max || r.at < cut).map(([id]) => id)
}

export function isUseRecord(v: unknown): v is UseRecord {
  return !!v && typeof v === 'object' && typeof (v as UseRecord).at === 'number' && !!(v as UseRecord).counts && typeof (v as UseRecord).counts === 'object'
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Connector (name, id) ↔ server name (`claude.ai Gmail`, `claude_ai_Gmail`, `<uuid>`). */
export function sameServer(server: string, name: string, id?: string): boolean {
  if (id && server === id) return true
  const a = norm(server)
  const b = norm(name)
  return !!b && (a === b || a.endsWith(b))
}

export function pastFor(past: Map<string, Past>, name: string, id?: string): Past | undefined {
  for (const [key, p] of past) if (!key.startsWith('plugin:') && sameServer(key, name, id)) return p
  return undefined
}

/** Calls this session made to a server (by name/id) or to a plugin. */
export function callsTo(counts: Map<string, number>, name: string, id?: string): number {
  let n = 0
  for (const [t, c] of counts) if (useKeys(t).keys.some(key => !key.startsWith('plugin:') && sameServer(key, name, id))) n += c
  return n
}

export function callsToPlugin(counts: Map<string, number>, name: string): number {
  let n = 0
  for (const [t, c] of counts) if (useKeys(t).keys.includes(`plugin:${name}`)) n += c
  return n
}

const isPluginServer = (server: string) => /^plugin[:_]/.test(server)

export function serverTokens(bd: Bd | undefined): Map<string, Tok> {
  const out = new Map<string, Tok>()
  for (const t of bd?.mcpTools ?? []) {
    const v = out.get(t.serverName) ?? { loaded: 0, deferred: 0, count: 0 }
    if (t.isLoaded) v.loaded += t.tokens
    else v.deferred += t.tokens
    v.count += 1
    out.set(t.serverName, v)
  }
  return out
}

/** Servers in the breakdown that are not a plugin's (those count under the plugin). */
export function plainServers(st: Map<string, Tok>): string[] {
  return [...st.keys()].filter(s => !isPluginServer(s)).sort()
}

export function connTok(st: Map<string, Tok>, name: string, id?: string): Tok | undefined {
  for (const [server, t] of st) if (sameServer(server, name, id)) return t
  return undefined
}

/** What one plugin loaded this session: skill list + loaded server tools + agent descriptions. */
export function pluginTokens(bd: Bd | undefined, name: string): { skills: number; tools: number; agents: number; total: number } {
  const skills = (bd?.skills?.skillFrontmatter ?? []).filter(s => s.pluginName === name).reduce((a, s) => a + s.tokens, 0)
  const owns = (s: string) => s.startsWith(`plugin:${name}:`) || s.startsWith(`plugin_${name}_`)
  const tools = (bd?.mcpTools ?? []).filter(t => t.isLoaded && owns(t.serverName)).reduce((a, t) => a + t.tokens, 0)
  const agents = (bd?.agents ?? []).filter(a => a.agentType.startsWith(`${name}:`)).reduce((a, x) => a + x.tokens, 0)
  return { skills, tools, agents, total: skills + tools + agents }
}

const isMessages = (name: string) => /^messages?$/i.test(name.trim())

/** Fixed start load: every `used` row but the conversation — what a new session loads again. */
export function fixedRows(bd: Bd | undefined): { name: string; tokens: number }[] {
  return (bd?.categories ?? []).filter(c => (c.kind ?? 'used') === 'used' && !isMessages(c.name) && c.tokens > 0)
}

export function fixedLoad(bd: Bd | undefined): number | undefined {
  const n = fixedRows(bd).reduce((s, c) => s + c.tokens, 0)
  return n > 0 ? n : undefined
}

// ---- plugins (port of the user's on/off script: settings.json `enabledPlugins`) ----

type Manifest = { plugins?: { name?: unknown; description?: unknown }[] }
type Installed = { plugins?: Record<string, unknown> }

/**
 * Every plugin the person has: keys of `enabledPlugins`, `installed_plugins.json`, and plugins
 * synced from claude.ai (`<name>@synced`, on unless set false). Sorted by name.
 */
export function listPlugins(enabled: unknown, installed: Installed | undefined, synced: Manifest[], self?: string): Plug[] {
  const flags = enabled && typeof enabled === 'object' ? (enabled as Record<string, unknown>) : {}
  const out = new Map<string, Plug>()
  const add = (key: string, desc?: string) => {
    const name = key.split('@')[0] ?? key
    if (!name || name === self) return
    const v = flags[key]
    const isOn = typeof v === 'boolean' ? v : key.endsWith('@synced')
    const old = out.get(key)
    out.set(key, { key, name, isOn, desc: desc ?? old?.desc })
  }
  for (const key of Object.keys(flags)) add(key)
  for (const key of Object.keys(installed?.plugins ?? {})) add(key)
  for (const m of synced) {
    for (const p of m.plugins ?? []) {
      if (typeof p.name === 'string' && p.name) add(`${p.name}@synced`, typeof p.description === 'string' ? p.description : undefined)
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** settings.json text with `enabledPlugins[key] = on` for every key; undefined when the text is not a JSON object. */
export function withPlugins(text: string, keys: string[], on: boolean): string | undefined {
  let v: unknown
  try {
    v = text.trim() ? JSON.parse(text) : {}
  } catch {
    return undefined
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const obj = v as Record<string, unknown>
  const cur = obj.enabledPlugins && typeof obj.enabledPlugins === 'object' ? (obj.enabledPlugins as Record<string, unknown>) : {}
  const next: Record<string, unknown> = { ...cur }
  for (const key of keys) next[key] = on
  return `${JSON.stringify({ ...obj, enabledPlugins: next }, null, 2)}\n`
}

// ---- descriptions (shown when a row is opened) ----

const DESC: [string, string, string][] = [
  ['gmail', 'Search, read and draft mail', '메일 검색·읽기·초안 쓰기'],
  ['googlecalendar', 'Google Calendar: view and create events', '구글 캘린더 — 일정 보기·만들기'],
  ['googledrive', 'Google Drive: search and read files', '구글 드라이브 — 파일 검색·읽기'],
  ['notion', 'Notion: search, read and write pages', '노션 — 페이지 검색·읽기·쓰기'],
  ['slack', 'Slack: read and send messages', '슬랙 — 메시지 읽기·보내기'],
  ['canva', 'Canva: create, edit and export designs', '캔바 — 디자인 만들기·편집·내보내기'],
  ['github', 'GitHub: repositories, issues, pull requests', '깃허브 — 저장소·이슈·PR'],
  ['linear', 'Linear: issues and projects', '리니어 — 이슈·프로젝트'],
  ['figma', 'Figma: read designs and components', '피그마 — 디자인·컴포넌트 읽기'],
  ['asana', 'Asana: tasks and projects', '아사나 — 할 일·프로젝트'],
  ['atlassian', 'Jira and Confluence', '지라·컨플루언스'],
  ['sentry', 'Sentry: errors and issues', '센트리 — 오류·이슈'],
  ['scheduledtasks', 'Create and run scheduled tasks', '예약 작업 만들기·실행'],
  ['pdfviewer', 'Open, annotate and fill PDFs', 'PDF 열기·주석·양식 채우기'],
  ['visualize', 'Draws charts and widgets in the chat', '대화 안에 그림·차트·위젯 그리기'],
  ['claudeinchrome', 'Drives your Chrome browser', '크롬 브라우저 조작'],
  ['computeruse', 'Screenshots and controls the desktop', '데스크톱 화면 보기·조작'],
  ['playwright', 'Browser automation', '브라우저 자동화'],
  ['context7', 'Up-to-date library docs', '최신 라이브러리 문서'],
  ['filesystem', 'Reads and writes local files', '로컬 파일 읽기·쓰기'],
]

export function describe(name: string): string | undefined {
  const n = norm(name)
  const hit = DESC.find(([key]) => n === key || n.endsWith(key))
  return hit ? (lang() === 'ko' ? hit[2] : hit[1]) : undefined
}

const t = defineStrings({
  en: {
    sys: 'System prompt',
    sysD: 'Base instructions read on every request (CLAUDE.md not included)',
    toolsDef: 'System tools (deferred)',
    toolsDefD: 'Built-in tools listed by name only, loaded when needed',
    tools: 'System tools',
    toolsD: 'Descriptions of built-in tools such as read, write, run',
    mcpDef: 'MCP tools (deferred)',
    mcpDefD: 'Connector/server tools listed by name only; loaded on search',
    mcp: 'MCP tools',
    mcpD: 'Connector/server tools with full descriptions loaded',
    agents: 'Custom agents',
    agentsD: 'Descriptions of sub-agent types',
    memory: 'Memory files',
    memoryD: 'CLAUDE.md and other memory files',
    skills: 'Skills',
    skillsD: 'Skill names and descriptions; grows with every enabled plugin',
    msgs: 'Messages',
    msgsD: 'The conversation and tool results so far; grows each turn, starts at 0 in a new session',
    free: 'Free space',
    freeD: 'Context not used yet',
    buffer: 'Autocompact buffer',
    bufferD: 'Space kept free for automatic compaction',
    noDesc: 'No description',
    now: 'This session: called {n} times',
    noPast: 'No use recorded in past sessions',
    past: 'Past {s} sessions: {c} calls, last {d}',
    top: 'Most used: {list}',
  },
  ko: {
    sys: '기본 지침',
    sysD: '매 요청마다 다시 읽는 기본 지침(CLAUDE.md 제외)',
    toolsDef: '기본 도구(대기)',
    toolsDefD: '이름만 실려 있고 필요할 때 불러오는 기본 도구',
    tools: '기본 도구',
    toolsD: '읽기·쓰기·명령 실행 같은 기본 도구 설명',
    mcpDef: 'MCP 도구(대기)',
    mcpDefD: '커넥터·서버 도구 중 이름만 실린 것 — 검색해서 불러와야 실림',
    mcp: 'MCP 도구',
    mcpD: '커넥터·서버 도구 중 설명까지 실린 것',
    agents: '에이전트 목록',
    agentsD: '하위 에이전트 종류 설명',
    memory: '기억 파일',
    memoryD: 'CLAUDE.md 같은 기억 파일',
    skills: '스킬 목록',
    skillsD: '스킬 이름·설명 목록 — 플러그인이 켜져 있으면 커짐',
    msgs: '대화 내용',
    msgsD: '지금까지의 대화·도구 결과 — 길어질수록 커지고 새 세션은 0부터',
    free: '빈 공간',
    freeD: '아직 쓰지 않은 컨텍스트',
    buffer: '자동 압축 여유분',
    bufferD: '자동 압축을 위해 비워 두는 몫',
    noDesc: '설명 없음',
    now: '이 세션: {n}번 부름',
    noPast: '지난 세션에서 쓴 기록 없음',
    past: '지난 세션 {s}개에서 {c}번 부름 · 마지막 {d}',
    top: '자주 쓴 도구: {list}',
  },
})

type CatKey = 'sys' | 'toolsDef' | 'tools' | 'mcpDef' | 'mcp' | 'agents' | 'memory' | 'skills' | 'msgs' | 'free' | 'buffer'
const CAT: [RegExp, CatKey][] = [
  [/system prompt/i, 'sys'],
  [/system tools.*deferred/i, 'toolsDef'],
  [/system tools/i, 'tools'],
  [/mcp tools.*deferred/i, 'mcpDef'],
  [/mcp tools/i, 'mcp'],
  [/agent/i, 'agents'],
  [/memory/i, 'memory'],
  [/skill/i, 'skills'],
  [/message/i, 'msgs'],
  [/free/i, 'free'],
  [/buffer|compact/i, 'buffer'],
]

export function catLabel(name: string): { label: string; desc: string } {
  for (const [re, key] of CAT) if (re.test(name)) return { label: t(key), desc: t(`${key}D` as `${CatKey}D`) }
  return { label: name, desc: name }
}

export function pastTip(desc: string | undefined, p: Past | undefined, nowUsed: number): string {
  const lines = [desc ?? t('noDesc')]
  if (nowUsed) lines.push(t('now', { n: nowUsed }))
  if (!p) {
    lines.push(t('noPast'))
  } else {
    const top = Object.entries(p.tools)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, n]) => `${name} ×${n}`)
    lines.push(t('past', { s: p.sessions, c: p.calls, d: p.last ? new Date(p.last).toISOString().slice(0, 10) : '?' }))
    if (top.length) lines.push(t('top', { list: top.join(', ') }))
  }
  return lines.join('\n')
}
