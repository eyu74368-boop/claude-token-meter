// Names shared between files. Only the main owner edits core/*.
export const PLUGIN = 'claude-token-meter'
export const PANE_EFF = 'token-meter-efficiency'
export const PANE_CHECK = 'token-meter-check'
export const CMD_EFF = 'token-meter'
export const CMD_CHECK = 'token-check'

/** CSV files under dataDirOf(home); the first column is always an ISO time (for rotateCsv). */
export const TURNS_CSV = 'turns.csv'
export const TURNS_HEADER = ['time', 'session', 'turn', 'ctx', 'window', 'eff', 'jump', 'cached'] as const
export const WASTE_CSV = 'waste.csv'
export const WASTE_HEADER = ['time', 'session', 'turn', 'jump', 'ctx', 'tools'] as const
