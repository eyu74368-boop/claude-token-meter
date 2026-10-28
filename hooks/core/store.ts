// Pure path and CSV helpers. The engine (`$`) may only be used in the file whose hook holds it,
// so callers do the reading/writing themselves:
//   const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '.'
//   const file = join(dataDirOf(home), 'turns.csv')
//   const old = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
//   await $.fs.write(file, appendCsv(old, row, HEADER))

/** Joins path parts with `/` (accepted on Windows too), dropping duplicate separators. */
export function join(...parts: string[]): string {
  return parts
    .filter(p => p !== '')
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join('/')
    .replace(/\\/g, '/')
}

/** `~/.claude`, where Claude Code keeps settings and transcripts (read only). */
export const claudeDirOf = (home: string): string => join(home, '.claude')

/** `~/.claude/token-meter`, the one folder this mod writes to. */
export const dataDirOf = (home: string): string => join(claudeDirOf(home), 'token-meter')

const cell = (v: string | number): string => {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const csvLine = (row: readonly (string | number)[]): string => row.map(cell).join(',')

/** Splits one CSV line, honoring quotes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** CSV text as rows (header included); [] for empty text. */
export const csvRows = (text: string): string[][] =>
  text
    .split(/\r?\n/)
    .filter(l => l !== '')
    .map(parseCsvLine)

/**
 * `old` with one row appended; `header` goes first when `old` is empty.
 * The first column should be an ISO timestamp so rotateCsv() can trim by age.
 */
export function appendCsv(old: string, row: readonly (string | number)[], header?: readonly string[]): string {
  const head = old === '' && header ? csvLine(header) + '\n' : ''
  const sep = old !== '' && !old.endsWith('\n') ? '\n' : ''
  return old + sep + head + csvLine(row) + '\n'
}

/**
 * Drops rows whose first column (ISO time) is older than `days` before `nowMs`; keeps the header
 * and any row whose first column is not a date. `dropped` 0 means the text need not be rewritten.
 */
export function rotateCsv(text: string, nowMs: number, days: number, hasHeader = true): { text: string; dropped: number } {
  if (text === '') return { text, dropped: 0 }
  const cutoff = nowMs - days * 86400000
  const lines = text.split(/\r?\n/).filter(l => l !== '')
  const kept = lines.filter((l, i) => {
    if (hasHeader && i === 0) return true
    const at = Date.parse(parseCsvLine(l)[0] ?? '')
    return Number.isNaN(at) || at >= cutoff
  })
  const dropped = lines.length - kept.length
  return { text: dropped > 0 ? kept.join('\n') + '\n' : text, dropped }
}
