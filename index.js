/**
 * Session & workspace cost board — Host half.
 *
 * Reads token usage recorded in every live or persisted session through
 * `ctx.sessionQuery`, attributes each session to the workspace whose path
 * contains the session's cwd, and serves the estimate over a loopback-only
 * JSON route. No data is written and nothing outside DSH is read except the
 * optional pricing override file.
 */
import { readFile, stat, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'session-cost'
export const inject = ['webServer', 'sessionQuery', 'workspaceRegistry']

const ROUTE_PREFIX = '/session-cost/api'
const BUILTIN_CURRENCY = 'CNY'
const SUMMARY_TTL_MS = 8000
const READ_CONCURRENCY = 6
const LOCALE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'locale')

/**
 * Official CNY prices per 1,000,000 tokens (api-docs.deepseek.com, 模型 & 价格).
 *
 * Peak hours are Beijing time Monday–Friday 09:00–12:00 and 14:00–18:00,
 * excluding Chinese statutory holidays; every other moment is off-peak at
 * half the peak rate. `holidays` from the pricing file removes holiday days
 * from the peak set.
 */
const FLASH_PRICE = {
  peak: { input: 2, output: 8, cacheRead: 0.04, cacheWrite: 0 },
  offPeak: { input: 1, output: 4, cacheRead: 0.02, cacheWrite: 0 }
}
const PRO_PRICE = {
  peak: { input: 9, output: 27, cacheRead: 0.3, cacheWrite: 0 },
  offPeak: { input: 4.5, output: 13.5, cacheRead: 0.15, cacheWrite: 0 }
}
const BUILTIN_PRICES = {
  'deepseek-flash': FLASH_PRICE,
  'deepseek-v4-flash': FLASH_PRICE,
  'deepseek-v4-flash-vision-exp': FLASH_PRICE,
  'deepseek-v4-pro': PRO_PRICE,
  'deepseek/*': FLASH_PRICE
}
const PEAK_WINDOWS = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60]
]
const BEIJING_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

/** Per-minute memo of the Beijing-time peak decision. */
const peakMemo = new Map()

function isPeakTime(ms, holidays) {
  const minute = Math.floor(ms / 60000)
  const hit = peakMemo.get(minute)
  if (hit !== undefined) return hit
  let weekday = ''
  let date = ''
  let minutes = 0
  for (const part of BEIJING_CLOCK.formatToParts(new Date(minute * 60000))) {
    if (part.type === 'weekday') weekday = part.value
    else if (part.type === 'year') date = part.value
    else if (part.type === 'month') date += '-' + part.value
    else if (part.type === 'day') date += '-' + part.value
    else if (part.type === 'hour') minutes = Number(part.value) * 60
    else if (part.type === 'minute') minutes += Number(part.value)
  }
  const workday = weekday !== 'Sat' && weekday !== 'Sun'
  const inWindow = PEAK_WINDOWS.some(([from, to]) => minutes >= from && minutes < to)
  const peak = workday && inWindow && !holidays.has(date)
  if (peakMemo.size > 5000) peakMemo.clear()
  peakMemo.set(minute, peak)
  return peak
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function isLoopback(req) {
  const remote = req.socket?.remoteAddress ?? ''
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text)
  })
  res.end(text)
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizePath(value) {
  return String(value ?? '')
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

function isUnder(path, root) {
  if (!root) return false
  return path === root || path.startsWith(root + '\\') || path.startsWith(root + '/')
}

function pickPrice(table, provider, model) {
  const route = `${provider}/${model}`
  const candidates = [route, model, `${provider}/*`, '*']
  for (const key of candidates) {
    const hit = table[key]
    if (hit !== undefined) return hit
  }
  return undefined
}

function rates(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    input: num(source.input),
    output: num(source.output),
    cacheRead: num(source.cacheRead),
    cacheWrite: num(source.cacheWrite)
  }
}

/** Accept either `{peak, offPeak}` or a flat rate object (applied to both). */
function normalizePrice(value) {
  if (!value || typeof value !== 'object') return undefined
  if (value.peak || value.offPeak) {
    const peak = rates(value.peak || value.offPeak)
    return { peak, offPeak: rates(value.offPeak || value.peak) }
  }
  const flat = rates(value)
  return { peak: flat, offPeak: flat }
}

let pricingCache = { at: 0, value: undefined }

async function loadPricing() {
  const file = join(dshHome(), 'storages', 'session-cost-pricing.json')
  let mtime = 0
  try {
    mtime = (await stat(file)).mtimeMs
  } catch {
    mtime = 0
  }
  if (pricingCache.value !== undefined && pricingCache.at === mtime) return pricingCache.value

  let table = { ...BUILTIN_PRICES }
  let source = 'builtin'
  let currency = BUILTIN_CURRENCY
  let holidays = new Set()
  let error = null
  if (mtime > 0) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      const models = parsed && typeof parsed === 'object' ? parsed.models : undefined
      if (typeof parsed.currency === 'string' && parsed.currency.trim() !== '') {
        currency = parsed.currency.trim().toUpperCase()
      }
      if (Array.isArray(parsed.holidays)) {
        holidays = new Set(
          parsed.holidays
            .map((day) => String(day).trim())
            .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
        )
      }
      if (models && typeof models === 'object') {
        const merged = { ...table }
        for (const [key, price] of Object.entries(models)) {
          const normalized = normalizePrice(price)
          if (normalized !== undefined) merged[key] = normalized
        }
        table = merged
        source = 'file'
      } else {
        error = 'pricing file has no "models" object'
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }
  peakMemo.clear()
  const value = { currency, source, file, error, table, holidays }
  pricingCache = { at: mtime, value }
  return value
}

let localeCache = { at: 0, value: null }

/** UI dictionaries live in this package's locale/*.json; the Client half fetches them. */
async function loadLocales() {
  const now = Date.now()
  if (localeCache.value !== null && now - localeCache.at < 60_000) return localeCache.value
  const locales = {}
  try {
    for (const file of await readdir(LOCALE_DIR)) {
      if (!file.endsWith('.json')) continue
      const id = file.slice(0, -5)
      try {
        const parsed = JSON.parse(await readFile(join(LOCALE_DIR, file), 'utf8'))
        const ui = parsed && typeof parsed.ui === 'object' && parsed.ui !== null ? parsed.ui : {}
        locales[id] = ui
      } catch {
        /* a broken locale file must not break the board */
      }
    }
  } catch {
    /* no locale directory: the Client half keeps its bootstrap label */
  }
  localeCache = { at: now, value: locales }
  return locales
}

function listWorkspaces(ctx) {  try {
    const raw = ctx.workspaceRegistry.list()
    return (Array.isArray(raw) ? raw : []).map((workspace) => {
      const path = String(workspace.path ?? '')
      return {
        id: String(workspace.id ?? path),
        path,
        title: String(workspace.title ?? '') || basename(path),
        normalized: normalizePath(path)
      }
    })
  } catch {
    return []
  }
}

function foldSession(events, inheritedEventCount, pricing) {
  const models = new Map()
  let requests = 0
  let lastAt = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let reasoningTokens = 0
  let cost = 0
  let costPeak = 0
  let costOffPeak = 0
  let peakCalls = 0
  let priced = true
  const unpriced = new Set()

  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    if (Number.isFinite(inheritedEventCount) && event.seq < inheritedEventCount) continue
    const usage = event.data && event.data.usage
    if (!usage) continue

    const source = (event.data.message && event.data.message.source) || {}
    const provider = String(source.provider ?? 'unknown')
    const model = String(source.model ?? 'unknown')
    const key = `${provider}/${model}`
    let bucket = models.get(key)
    if (bucket === undefined) {
      bucket = {
        provider,
        model,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
        costPeak: 0,
        costOffPeak: 0,
        peakCalls: 0,
        priced: true
      }
      models.set(key, bucket)
    }

    const input = num(usage.inputTokens)
    const output = num(usage.outputTokens)
    const cacheRead = num(usage.cacheReadTokens)
    const cacheWrite = num(usage.cacheWriteTokens)
    const reasoning = num(usage.reasoningTokens)

    const price = pickPrice(pricing.table, provider, model)
    let callCost = 0
    const peak = price === undefined ? false : isPeakTime(event.time, pricing.holidays)
    if (price === undefined) {
      bucket.priced = false
      priced = false
      unpriced.add(model)
    } else {
      const rate = peak ? price.peak : price.offPeak
      callCost =
        (input * rate.input +
          output * rate.output +
          cacheRead * rate.cacheRead +
          cacheWrite * rate.cacheWrite) /
        1_000_000
    }

    bucket.requests += 1
    bucket.inputTokens += input
    bucket.outputTokens += output
    bucket.cacheReadTokens += cacheRead
    bucket.cacheWriteTokens += cacheWrite
    bucket.cost += callCost
    if (peak) {
      bucket.costPeak += callCost
      bucket.peakCalls += 1
    } else {
      bucket.costOffPeak += callCost
    }

    requests += 1
    inputTokens += input
    outputTokens += output
    cacheReadTokens += cacheRead
    cacheWriteTokens += cacheWrite
    reasoningTokens += reasoning
    cost += callCost
    if (peak) {
      costPeak += callCost
      peakCalls += 1
    } else {
      costOffPeak += callCost
    }
    if (event.time > lastAt) lastAt = event.time
  }

  return {
    requests,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    tokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    cost,
    costPeak,
    costOffPeak,
    peakCalls,
    priced,
    lastAt,
    unpriced: [...unpriced],
    models: [...models.values()].sort((a, b) => b.cost - a.cost || b.requests - a.requests)
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

let summaryCache = { at: 0, value: undefined }
/** A persisted session log never gains events without becoming live again, so its fold is reusable. */
const sessionCache = new Map()
const titleCache = new Map()

async function buildSummary(ctx, force) {
  const now = Date.now()
  if (!force && summaryCache.value !== undefined && now - summaryCache.at < SUMMARY_TTL_MS) {
    return summaryCache.value
  }

  const pricing = await loadPricing()
  const records = await ctx.sessionQuery.listSessions()
  const workspaces = listWorkspaces(ctx)
  const missingTitles = []

  const rows = await mapLimit(records, READ_CONCURRENCY, async (record) => {
    const header = record.header
    const id = String(header.id)
    const cached = record.live === true ? undefined : sessionCache.get(id)
    let folded
    let title
    if (cached !== undefined) {
      folded = cached.folded
      title = cached.title
    } else {
      let snapshot
      try {
        snapshot = await ctx.sessionQuery.readSession(id)
      } catch {
        return null
      }
      folded = foldSession(snapshot.events, Number(snapshot.inheritedEventCount) || 0, pricing)
      title = titleCache.get(id) || ''
      if (title === '') missingTitles.push(id)
    }
    if (record.live !== true) sessionCache.set(id, { folded, title })
    return {
      id,
      title,
      cwd: header.cwd ? String(header.cwd) : '',
      createdAt: num(header.createdAt),
      parentSession: header.parentSession ? String(header.parentSession) : null,
      subagent: header.origin === 'subagent',
      live: record.live === true,
      archived: false,
      updatedAt: folded.lastAt || num(header.createdAt),
      requests: folded.requests,
      inputTokens: folded.inputTokens,
      outputTokens: folded.outputTokens,
      cacheReadTokens: folded.cacheReadTokens,
      cacheWriteTokens: folded.cacheWriteTokens,
      tokens: folded.tokens,
      cost: folded.cost,
      costPeak: folded.costPeak,
      costOffPeak: folded.costOffPeak,
      peakCalls: folded.peakCalls,
      priced: folded.priced,
      unpriced: folded.unpriced,
      models: folded.models
    }
  })

  const sessions = rows.filter((row) => row !== null)

  if (missingTitles.length > 0) {
    try {
      const observations = await ctx.sessionQuery.readTitleSnapshots(missingTitles)
      const byId = new Map(sessions.map((session) => [session.id, session]))
      for (const observation of observations) {
        if (observation.status !== 'fulfilled' || !observation.value.title) continue
        const title = observation.value.title.title
        titleCache.set(observation.sessionId, title)
        const row = byId.get(String(observation.sessionId))
        if (row !== undefined) row.title = title
        const cached = sessionCache.get(String(observation.sessionId))
        if (cached !== undefined) cached.title = title
      }
    } catch {
      /* titles are decorative; usage still counts */
    }
  }
  const buckets = new Map()
  const ensure = (key, title, path) => {
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = {
        id: key,
        title,
        path,
        cost: 0,
        costPeak: 0,
        costOffPeak: 0,
        peakCalls: 0,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        requests: 0,
        sessions: []
      }
      buckets.set(key, bucket)
    }
    return bucket
  }

  for (const session of sessions) {
    const cwd = normalizePath(session.cwd)
    let owner
    for (const workspace of workspaces) {
      if (!isUnder(cwd, workspace.normalized)) continue
      if (owner === undefined || workspace.normalized.length > owner.normalized.length) owner = workspace
    }
    const bucket =
      owner === undefined
        ? ensure('__unassigned__', '', '')
        : ensure(owner.id, owner.title, owner.path)
    bucket.cost += session.cost
    bucket.costPeak += session.costPeak
    bucket.costOffPeak += session.costOffPeak
    bucket.peakCalls += session.peakCalls
    bucket.tokens += session.tokens
    bucket.inputTokens += session.inputTokens
    bucket.outputTokens += session.outputTokens
    bucket.cacheReadTokens += session.cacheReadTokens
    bucket.cacheWriteTokens += session.cacheWriteTokens
    bucket.requests += session.requests
    bucket.sessions.push(session)
  }

  const groups = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      sessions: bucket.sessions.sort((a, b) => b.cost - a.cost || b.updatedAt - a.updatedAt)
    }))
    .sort((a, b) => b.cost - a.cost || a.title.localeCompare(b.title))

  const totals = {
    cost: 0,
    costPeak: 0,
    costOffPeak: 0,
    peakCalls: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    requests: 0,
    sessions: sessions.length,
    unpriced: new Set()
  }
  for (const session of sessions) {
    totals.cost += session.cost
    totals.costPeak += session.costPeak
    totals.costOffPeak += session.costOffPeak
    totals.peakCalls += session.peakCalls
    totals.tokens += session.tokens
    totals.inputTokens += session.inputTokens
    totals.outputTokens += session.outputTokens
    totals.cacheReadTokens += session.cacheReadTokens
    totals.cacheWriteTokens += session.cacheWriteTokens
    totals.requests += session.requests
    for (const model of session.unpriced) totals.unpriced.add(model)
  }

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    currency: pricing.currency,
    pricing: {
      source: pricing.source,
      file: pricing.file,
      error: pricing.error
    },
    totals: { ...totals, unpriced: [...totals.unpriced] },
    workspaces: groups
  }
  summaryCache = { at: now, value: result }
  return result
}

function createHandler(ctx) {
  return async (req, res) => {
    try {
      if (!isLoopback(req)) {
        sendJson(res, 403, { ok: false, error: 'loopback only' })
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const rest = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : url.pathname
      if (rest === '/summary' || rest === '/summary/') {
        const force = url.searchParams.get('refresh') === '1'
        const summary = await buildSummary(ctx, force)
        sendJson(res, 200, summary)
        return
      }
      if (rest === '/locales' || rest === '/locales/') {
        sendJson(res, 200, { ok: true, locales: await loadLocales() })
        return
      }
      sendJson(res, 404, { ok: false, error: `unknown route ${url.pathname}` })
    } catch (cause) {
      sendJson(res, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }
}

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: createHandler(ctx)
      }),
    'session-cost: summary api'
  )
}
