window.__ModuleLoader__.load({
  id: 'dsh-session-cost',
  factory(require) {
    const React = require('react')
    const { useSyncExternalStore, useEffect } = React
    const h = React.createElement

    /* ------------------------------------------------------------------ */
    /* module store: the footer button and the overlay share one board     */
    /* state so the two slot occupants never need another service.         */
    /* ------------------------------------------------------------------ */
    const listeners = new Set()
    let state = { open: false, status: 'idle', data: null, error: null }
    const subscribe = (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
    const getSnapshot = () => state
    const setState = (patch) => {
      state = { ...state, ...patch }
      for (const fn of listeners) fn()
    }

    let inFlight = null
    async function load(force) {
      if (inFlight) return inFlight
      setState({ status: 'loading', error: null })
      inFlight = (async () => {
        try {
          const url = '/session-cost/api/summary' + (force ? '?refresh=1' : '')
          const response = await fetch(url, { headers: { accept: 'application/json' } })
          const body = await response.json()
          if (!response.ok || body.ok !== true) {
            throw new Error(body && body.error ? body.error : 'HTTP ' + response.status)
          }
          moneySymbol = symbolFor(body.currency)
          setState({ status: 'ready', data: body, error: null })
        } catch (cause) {
          setState({ status: 'error', error: cause instanceof Error ? cause.message : String(cause) })
        } finally {
          inFlight = null
        }
      })()
      return inFlight
    }

    const openBoard = () => {
      setState({ open: true })
      void load(true)
    }
    const closeBoard = () => setState({ open: false })

    /* ------------------------------------------------------------------ */
    /* locale: dictionaries come from the package's locale/*.json files,   */
    /* served by the Host half; only the button label is bootstrapped.     */
    /* ------------------------------------------------------------------ */
    const BOOT = {
      en: { label: 'Cost', title: 'Session cost' },
      zh: { label: '成本', title: '会话成本' }
    }
    let dictionaries = null
    let lang = 'en'
    const isZh = () => lang.indexOf('zh') === 0

    function pickLang(ctx) {
      try {
        const snapshot = ctx.locale.getLocale()
        const active = String(
          (snapshot && (snapshot.active || snapshot.id || snapshot.locale || snapshot.current)) || 'en'
        )
        return active.toLowerCase()
      } catch {
        return 'en'
      }
    }

    /** Exact id first, then its primary subtag, then English. */
    function dictFor(id) {
      if (!dictionaries) return null
      if (dictionaries[id]) return dictionaries[id]
      const primary = String(id).split('-')[0]
      if (dictionaries[primary]) return dictionaries[primary]
      return dictionaries.en || null
    }

    function t(key) {
      const dict = dictFor(lang)
      if (dict && typeof dict[key] === 'string') return dict[key]
      const boot = BOOT[lang] || BOOT[String(lang).split('-')[0]] || BOOT.en
      if (typeof boot[key] === 'string') return boot[key]
      if (dictionaries && dictionaries.en && typeof dictionaries.en[key] === 'string') {
        return dictionaries.en[key]
      }
      return key
    }

    async function loadDictionaries() {
      try {
        const response = await fetch('/session-cost/api/locales', { headers: { accept: 'application/json' } })
        const body = await response.json()
        if (body && body.ok === true && body.locales) {
          dictionaries = body.locales
          setState({})
        }
      } catch {
        /* keep the bootstrap label; data still renders with key names */
      }
    }

    /* ------------------------------------------------------------------ */
    /* format                                                             */
    /* ------------------------------------------------------------------ */
    let moneySymbol = '¥'
    const symbolFor = (code) => {
      const currency = String(code || '').toUpperCase()
      if (currency === 'USD') return '$'
      if (currency === 'EUR') return '€'
      if (currency === 'CNY' || currency === 'RMB') return '¥'
      return currency === '' ? '¥' : currency + ' '
    }

    function fmtTokens(value) {
      const n = Number(value) || 0
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
      if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k'
      return String(Math.round(n))
    }
    function fmtCost(value, fallback) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback || '—'
      if (value === 0) return moneySymbol + '0.00'
      if (value < 0.01) return '<' + moneySymbol + '0.01'
      if (value < 10000) return moneySymbol + value.toFixed(2)
      return moneySymbol + Math.round(value).toLocaleString('en-US')
    }
    function fmtDate(ms) {
      if (!ms) return ''
      try {
        return new Date(ms).toLocaleString(isZh() ? 'zh-CN' : 'en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      } catch {
        return ''
      }
    }

    /* ------------------------------------------------------------------ */
    /* styles: theme tokens only                                          */
    /* ------------------------------------------------------------------ */
    const CSS = `
.sc-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:0;border-radius:7px;
  background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;cursor:pointer}
.sc-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sc-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sc-btn[data-rail="true"]{padding:0;width:28px;justify-content:center}
.sc-backdrop{position:fixed;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;
  background:color-mix(in srgb, var(--dsw-alias-bg-base) 55%, rgba(0,0,0,.45));padding:32px}
.sc-panel{width:min(880px,100%);max-height:min(760px,100%);display:flex;flex-direction:column;overflow:hidden;
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l1);border-radius:14px;
  box-shadow:0 24px 64px rgba(0,0,0,.35);font-size:13px;line-height:1.5}
.sc-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.sc-title{font-size:15px;font-weight:600;margin:0}
.sc-sub{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-spacer{flex:1}
.sc-iconbtn{width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);
  cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.sc-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sc-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sc-total{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 20px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.sc-total strong{font-size:26px;font-weight:650;letter-spacing:-.01em}
.sc-total .sc-meta{color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-body{overflow:auto;padding:8px 12px 16px}
.sc-group{margin:6px 0}
.sc-grouphead{display:flex;align-items:center;gap:8px;width:100%;padding:10px 8px;border:0;border-radius:8px;
  background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.sc-grouphead:hover{background:var(--dsw-alias-bg-layer-2)}
.sc-grouphead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.sc-gname{font-weight:600}
.sc-gpath{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
.sc-gcost{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600}
.sc-bar{height:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);margin:0 8px 6px;overflow:hidden}
.sc-bar>i{display:block;height:100%;background:var(--dsw-alias-brand-primary)}
.sc-sessions{display:flex;flex-direction:column;gap:1px;padding:0 2px 6px 8px}
.sc-row{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:7px}
.sc-row:hover{background:var(--dsw-alias-bg-layer-2)}
.sc-name{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.sc-stitle{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-smeta{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-scost{font-variant-numeric:tabular-nums;white-space:nowrap;min-width:72px;text-align:right}
.sc-more{margin:2px 8px 4px;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);
  font:inherit;font-size:12px;text-align:left;cursor:pointer}
.sc-more:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sc-more:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.sc-note{padding:10px 18px 14px;color:var(--dsw-alias-label-secondary);font-size:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.sc-empty{padding:40px 16px;text-align:center;color:var(--dsw-alias-label-secondary)}
.sc-error{margin:16px;padding:12px 14px;border-radius:8px;color:var(--dsw-alias-state-error-primary);
  border:1px solid var(--dsw-alias-state-error-primary);font-size:12px;word-break:break-word}
.sc-chip{display:inline-block;padding:1px 6px;border-radius:999px;font-size:11px;
  border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.sc-models{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.sc-model{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
`

    function Icon({ size = 16 }) {
      return h(
        'svg',
        { viewBox: '0 0 20 20', width: size, height: size, 'aria-hidden': true, fill: 'none' },
        h('path', {
          d: 'M3 15.5V9M7.5 15.5V5M12 15.5v-4M16.5 15.5V7.5',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round'
        })
      )
    }

    function CostButton(props) {
      useSyncExternalStore(subscribe, getSnapshot)
      const wide = !props || props.wide !== false
      return h(
        React.Fragment,
        null,
        h('style', null, CSS),
        h(
          'button',
          {
            type: 'button',
            className: 'sc-btn',
            'data-rail': wide ? 'false' : 'true',
            title: t('label'),
            'aria-label': t('label'),
            onClick: openBoard
          },
          h(Icon),
          wide ? h('span', null, t('label')) : null
        )
      )
    }

    function SessionRow({ session }) {
      const active = session.priced ? fmtCost(session.cost) : t('noCost')
      const meta = [
        fmtDate(session.updatedAt),
        session.requests + ' ' + t('requests'),
        fmtTokens(session.tokens) + ' ' + t('tokens')
      ]
        .filter(Boolean)
        .join(' · ')
      const models = session.models || []
      return h(
        'div',
        { className: 'sc-row' },
        h(
          'div',
          { className: 'sc-name' },
          h('div', { className: 'sc-stitle' }, session.title || session.id),
          h(
            'div',
            { className: 'sc-smeta' },
            meta,
            session.subagent ? h('span', { className: 'sc-chip', style: { marginLeft: 6 } }, t('subagent')) : null
          ),
          models.length > 0
            ? h(
                'div',
                { className: 'sc-models' },
                models.map((entry) =>
                  h(
                    'span',
                    {
                      className: 'sc-chip sc-model',
                      key: entry.provider + '/' + entry.model,
                      title:
                        entry.provider +
                        '/' +
                        entry.model +
                        ' · ' +
                        t('peak') +
                        ' ' +
                        fmtCost(entry.costPeak) +
                        ' · ' +
                        t('offPeak') +
                        ' ' +
                        fmtCost(entry.costOffPeak)
                    },
                    entry.model + ' ' + fmtCost(entry.cost)
                  )
                )
              )
            : null
        ),
        h('div', { className: 'sc-scost' }, active)
      )
    }

    function Group({ group, maxCost }) {
      const [collapsed, setCollapsed] = React.useState(false)
      const [showSubagents, setShowSubagents] = React.useState(false)
      const share = maxCost > 0 ? Math.max(0.02, group.cost / maxCost) : 0
      const main = group.sessions.filter((session) => !session.subagent)
      const subagents = group.sessions.filter((session) => session.subagent)
      const subagentCost = subagents.reduce((sum, session) => sum + (session.cost || 0), 0)
      return h(
        'section',
        { className: 'sc-group' },
        h(
          'button',
          {
            type: 'button',
            className: 'sc-grouphead',
            'aria-expanded': !collapsed,
            onClick: () => setCollapsed((value) => !value)
          },
          h(
            'svg',
            {
              viewBox: '0 0 12 12',
              width: 12,
              height: 12,
              'aria-hidden': true,
              style: {
                transform: collapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform .12s ease',
                color: 'var(--dsw-alias-label-secondary)'
              }
            },
            h('path', { d: 'M2.5 4.5 6 8l3.5-3.5', stroke: 'currentColor', strokeWidth: 1.4, fill: 'none', strokeLinecap: 'round' })
          ),
          h('span', { className: 'sc-gname' }, group.title || t('unassigned')),
          group.path ? h('span', { className: 'sc-gpath', title: group.path }, group.path) : null,
          h('span', { className: 'sc-gcost' }, fmtCost(group.cost)),
          h('span', { className: 'sc-gpath' }, group.sessions.length + ' ' + t('sessions'))
        ),
        h('div', { className: 'sc-bar' }, h('i', { style: { width: (share * 100).toFixed(1) + '%' } })),
        collapsed
          ? null
          : h(
              'div',
              { className: 'sc-sessions' },
              main.map((session) => h(SessionRow, { key: session.id, session })),
              subagents.length > 0
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'sc-more',
                      'aria-expanded': showSubagents,
                      onClick: () => setShowSubagents((value) => !value)
                    },
                    (showSubagents ? '− ' : '+ ') +
                      subagents.length +
                      ' ' +
                      t('subagentSessions') +
                      ' · ' +
                      fmtCost(subagentCost)
                  )
                : null,
              showSubagents
                ? subagents.map((session) => h(SessionRow, { key: session.id, session }))
                : null
            )
      )
    }

    function Board() {
      const snapshot = useSyncExternalStore(subscribe, getSnapshot)
      useEffect(() => {
        if (!snapshot.open) return
        const onKey = (event) => {
          if (event.key === 'Escape') closeBoard()
        }
        window.addEventListener('keydown', onKey)
        const timer = window.setInterval(() => {
          void load(true)
        }, 30000)
        return () => {
          window.removeEventListener('keydown', onKey)
          window.clearInterval(timer)
        }
      }, [snapshot.open])

      if (!snapshot.open) return null
      const data = snapshot.data
      const totals = data && data.totals
      const groups = (data && data.workspaces) || []
      const maxCost = groups.reduce((max, group) => Math.max(max, group.cost || 0), 0)
      const pricingSource = data && data.pricing && data.pricing.source === 'file' ? t('pricingFile') : t('pricingBuiltin')

      return h(
        'div',
        { className: 'sc-backdrop', onClick: closeBoard },
        h(
          'div',
          {
            className: 'sc-panel',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('title'),
            onClick: (event) => event.stopPropagation()
          },
          h('style', null, CSS),
          h(
            'div',
            { className: 'sc-head' },
            h(
              'div',
              null,
              h('h2', { className: 'sc-title' }, t('title')),
              h(
                'p',
                { className: 'sc-sub' },
                t('subtitle'),
                data ? ' · ' + pricingSource : '',
                data && data.generatedAt
                  ? ' · ' +
                    t('updated') +
                    ' ' +
                    new Date(data.generatedAt).toLocaleTimeString(isZh() ? 'zh-CN' : 'en-US', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : ''
              )
            ),
            h('div', { className: 'sc-spacer' }),
            h(
              'button',
              {
                type: 'button',
                className: 'sc-iconbtn',
                title: t('refresh'),
                'aria-label': t('refresh'),
                onClick: () => void load(true)
              },
              h(
                'svg',
                { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', 'aria-hidden': true },
                h('path', {
                  d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5.4h-2.9',
                  stroke: 'currentColor',
                  strokeWidth: 1.5,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round'
                })
              )
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'sc-iconbtn',
                title: t('close'),
                'aria-label': t('close'),
                onClick: closeBoard
              },
              h(
                'svg',
                { viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', 'aria-hidden': true },
                h('path', { d: 'M3.5 3.5l9 9m0-9l-9 9', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })
              )
            )
          ),
          totals
            ? h(
                'div',
                { className: 'sc-total' },
                h('strong', null, fmtCost(totals.cost)),
                h('span', { className: 'sc-meta' }, t('total')),
                h(
                  'span',
                  { className: 'sc-meta' },
                  totals.sessions + ' ' + t('sessions') +
                    ' · ' + totals.requests + ' ' + t('requests') +
                    ' · ' + fmtTokens(totals.tokens) + ' ' + t('tokens')
                ),
                h(
                  'span',
                  { className: 'sc-meta' },
                  t('input') + ' ' + fmtTokens(totals.inputTokens) +
                    ' · ' + t('output') + ' ' + fmtTokens(totals.outputTokens) +
                    ' · ' + t('cache') + ' ' + fmtTokens(totals.cacheReadTokens + totals.cacheWriteTokens)
                ),
                h(
                  'span',
                  { className: 'sc-meta' },
                  t('peak') + ' ' + fmtCost(totals.costPeak) +
                    ' · ' + t('offPeak') + ' ' + fmtCost(totals.costOffPeak) +
                    ' (' + totals.peakCalls + '/' + totals.requests + ' ' + t('peakCalls') + ')'
                )
              )
            : null,
          h(
            'div',
            { className: 'sc-body' },
            snapshot.status === 'loading' && data === null ? h('div', { className: 'sc-empty' }, t('loading')) : null,
            snapshot.status === 'error'
              ? h(
                  'div',
                  { className: 'sc-error' },
                  snapshot.error,
                  h(
                    'button',
                    { type: 'button', className: 'sc-btn', style: { marginLeft: 8 }, onClick: () => void load(true) },
                    t('retry')
                  )
                )
              : null,
            data !== null && groups.length === 0 ? h('div', { className: 'sc-empty' }, t('empty')) : null,
            data !== null ? groups.map((group) => h(Group, { key: group.id, group, maxCost })) : null
          ),
          h(
            'div',
            { className: 'sc-note' },
            t('estimateNote'),
            data && data.pricing && data.pricing.file ? ' ' + data.pricing.file : '',
            totals && totals.unpriced && totals.unpriced.length > 0
              ? ' · ' + t('unpriced') + ': ' + totals.unpriced.join(', ')
              : ''
          )
        )
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        lang = pickLang(ctx)
        void loadDictionaries()

        try {
          const dispose = ctx.locale.subscribe(() => {
            const next = pickLang(ctx)
            if (next === lang) return
            lang = next
            setState({})
          })
          ctx.effect(() => dispose)
        } catch {
          /* locale changes are cosmetic; the initial language still applies */
        }

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'session-cost', order: 40, label: () => t('label') },
            CostButton
          )
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'session-cost.board', order: 50 }, Board)
        )
      }
    }
  }
})
