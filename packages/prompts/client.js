'use strict'
// dsh-prompts — browser half (client plugin bundle).
//
// Surfaces:
//   1. Slash-triggered prompt panel: inputTriggers source ('/' candidates)
//      plus the conversation-input dock panel — browse/edit/insert over the
//      composer, never covering the message flow or the input box — and the
//      icon-only quick button in the composer tools row that opens it.
//   2. Save-as-prompt surfaces: turn-tail chip + modal, and composer-draft
//      save from the dock panel.
//   3. The management tab (提示词) inside the dsh-agent-profile 拓展 page,
//      contributed through that page's agent-profile.extensions.tab list
//      slot; the inject waits on the declaration, so without dsh-agent-
//      profile this bundle simply has no management tab.
//
// Data: /prompts-api prefix route (host half, ./web-api entry). Prompts are
// pure input assistance: nothing here reaches a model request or the
// session log.
;(function () {
  if (typeof window === 'undefined') return
  window.__ModuleLoader__.load({
    id: '@deepseek-ai/dsh-prompts',
    factory: function (require) {
      const react = require('react')
      const h = react.createElement

      /** Theme tokens resolving against the .dsp-scope layer injected below —
       *  light values by default, dark under .dsp-scope-dark. */
      const THEME = {
        ink: 'var(--dsp-ink, #eee)',
        inkSoft: 'var(--dsp-ink-soft, #999)',
        inkFaint: 'var(--dsp-ink-faint, #888)',
        accent: 'var(--dsp-accent, #4d86f8)',
        line: 'var(--dsp-line, #2a2a2e)',
        surface: 'var(--dsp-surface, #1c1c20)',
        surfaceSoft: 'var(--dsp-surface-soft, #1e1e22)',
        hover: 'var(--dsp-hover, rgba(77,134,248,0.12))',
        active: 'var(--dsp-active, rgba(77,134,248,0.2))',
        danger: '#e5484d',
      }

      const primaryButton = {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '5px 12px', borderRadius: '8px', border: 'none',
        background: THEME.accent, color: '#fff', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: '12px', lineHeight: '18px',
      }
      const ghostButton = {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '5px 12px', borderRadius: '8px',
        border: `1px solid ${THEME.line}`, background: 'transparent',
        color: THEME.ink, cursor: 'pointer',
        fontFamily: 'inherit', fontSize: '12px', lineHeight: '18px',
      }

      function isDark() {
        return typeof document !== 'undefined' && document.body !== null && document.body.hasAttribute('data-ds-dark-theme')
      }

      function injectStyles() {
        if (document.getElementById('dsh-prompts-scope-styles') !== null) return
        const style = document.createElement('style')
        style.id = 'dsh-prompts-scope-styles'
        style.textContent = [
          '.dsp-scope {',
          '  --dsp-ink: #1f2328;',
          '  --dsp-ink-soft: #57606a;',
          '  --dsp-ink-faint: #8b949e;',
          '  --dsp-accent: #2563eb;',
          '  --dsp-line: rgba(31, 35, 40, 0.14);',
          '  --dsp-line-2: rgba(31, 35, 40, 0.24);',
          '  --dsp-surface: #ffffff;',
          '  --dsp-surface-soft: #f5f6f8;',
          '  --dsp-hover: rgba(37, 99, 235, 0.08);',
          '  --dsp-active: rgba(37, 99, 235, 0.15);',
          '}',
          '.dsp-scope-dark {',
          '  --dsp-ink: #eee;',
          '  --dsp-ink-soft: #999;',
          '  --dsp-ink-faint: #888;',
          '  --dsp-accent: #4d86f8;',
          '  --dsp-line: #2a2a2e;',
          '  --dsp-line-2: #333;',
          '  --dsp-surface: #1c1c20;',
          '  --dsp-surface-soft: #1e1e22;',
          '  --dsp-hover: rgba(77, 134, 248, 0.12);',
          '  --dsp-active: rgba(77, 134, 248, 0.2);',
          '}',
          // Icon-only quick button inside the composer tools row. 28x28 round
          // like its neighbors; the 18px glyph matches the context-occupancy
          // button's SVG size.
          '.prp-composer-btn {',
          '  display: grid; place-items: center; flex: none;',
          '  width: 28px; height: 28px; padding: 0;',
          '  border: none; border-radius: 999px; background: transparent;',
          '  color: var(--dsw-alias-label-primary, currentColor);',
          '  cursor: pointer; font-size: 18px; line-height: 1; font-family: inherit;',
          '}',
          '.prp-composer-btn:hover {',
          '  background: var(--dsw-alias-interactive-bg-hover, rgba(77, 134, 248, 0.12));',
          '}',
        ].join('\n')
        document.head.appendChild(style)
      }

      /** JSON-over-HTTP client for /prompts-api (envelope form). */
      function createApi() {
        return async function api(method, payload) {
          const res = await fetch('/prompts-api/' + method, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'rpc', rpcId: String(Date.now()) + ':' + Math.random(), method: method, payload: payload === undefined ? {} : payload }),
          })
          const body = await res.json()
          if (!body.ok) throw new Error(body.error ? body.error.code + ': ' + body.error.message : 'prompts-api: http ' + res.status)
          return body.result
        }
      }

      /** Small observable over the prompt list (subscribe/getSnapshot pair for
       *  useSyncExternalStore; refresh() refetches). */
      function createPromptsStore(api) {
        let state = { prompts: undefined, loaded: false, error: undefined }
        const listeners = new Set()
        function set(next) { state = next; listeners.forEach(function (fn) { fn() }) }
        async function refresh() {
          try {
            const result = await api('prompts.list', {})
            set({ prompts: result.prompts, loaded: true, error: undefined })
          } catch (error) {
            set({ prompts: undefined, loaded: true, error: String(error && error.message || error) })
          }
        }
        return {
          refresh: refresh,
          getSnapshot: function () { return state },
          subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn) } },
        }
      }

      /** Composer panel state machine: browse (list) and edit (temp copy)
       *  modes. `pending.span` is the menu-time TokenSpan for CAS'd in-place
       *  insertion; insertion itself lives in insertPrompt (Task 6). */
      function createPanelStore() {
        let state = { open: false, mode: 'browse', sessionId: undefined, pending: undefined, pendingSpan: undefined, editedContent: undefined, query: '', filterTags: [], matchAll: false, highlight: 0 }
        const listeners = new Set()
        function set(next) { state = next; listeners.forEach(function (fn) { fn() }) }
        return {
          openBrowse: function (sessionId, span) {
            set({ open: true, mode: 'browse', sessionId: sessionId, pending: undefined, pendingSpan: span, editedContent: undefined, query: '', filterTags: [], matchAll: false, highlight: 0 })
          },
          openEdit: function (prompt, sessionId, span) {
            set({ open: true, mode: 'edit', sessionId: sessionId, pending: { prompt: prompt, span: span }, pendingSpan: span, editedContent: prompt.content, query: '', filterTags: [], matchAll: false, highlight: 0 })
          },
          openSaveDraft: function (sessionId, draft) {
            set({ open: true, mode: 'save', sessionId: sessionId, pending: { prompt: { title: firstLine(draft).slice(0, 40), content: draft, tags: [] }, span: undefined }, pendingSpan: undefined, editedContent: draft, query: '', filterTags: [], matchAll: false, highlight: 0 })
          },
          editPending: function (prompt) {
            set(Object.assign({}, state, { mode: 'edit', pending: { prompt: prompt, span: state.pendingSpan }, editedContent: prompt.content }))
          },
          backToBrowse: function () {
            set(Object.assign({}, state, { mode: 'browse', editedContent: undefined, highlight: 0 }))
          },
          close: function () {
            set(Object.assign({}, state, { open: false, mode: 'browse', pending: undefined, pendingSpan: undefined, editedContent: undefined, query: '', filterTags: [], highlight: 0 }))
          },
          setEdited: function (text) { set(Object.assign({}, state, { editedContent: text })) },
          setQuery: function (q) { set(Object.assign({}, state, { query: q })) },
          toggleTag: function (tag) {
            const next = state.filterTags.indexOf(tag) >= 0
              ? state.filterTags.filter(function (t) { return t !== tag })
              : state.filterTags.concat([tag])
            set(Object.assign({}, state, { filterTags: next }))
          },
          setMatchAll: function (v) { set(Object.assign({}, state, { matchAll: v })) },
          moveHighlight: function (delta, count) {
            if (count <= 0) return
            const next = (state.highlight + delta + count) % count
            set(Object.assign({}, state, { highlight: next }))
          },
          setHighlight: function (index) { set(Object.assign({}, state, { highlight: index })) },          getSnapshot: function () { return state },
          subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn) } },
        }
      }

      /** Pure filter shared by the page and the composer panel (Task 6). */
      function filterPrompts(list, query, tagSet, matchAll) {
        const q = query.trim().toLowerCase()
        return list.filter(function (p) {
          if (q !== '') {
            const haystack = (p.title + ' ' + p.content + ' ' + (p.note || '')).toLowerCase()
            if (!haystack.includes(q)) return false
          }
          if (tagSet !== null && tagSet.size > 0) {
            const hit = Array.from(tagSet).some(function (tag) { return p.tags.indexOf(tag) >= 0 })
            if (matchAll) {
              const all = Array.from(tagSet).every(function (tag) { return p.tags.indexOf(tag) >= 0 })
              if (!all) return false
            } else if (!hit) return false
          }
          return true
        })
      }

      function firstLine(text) {
        const index = text.indexOf('\n')
        return index < 0 ? text : text.slice(0, index)
      }

      function relativeTime(ts) {
        if (!ts) return ''
        const diff = Date.now() - ts
        const minute = 60 * 1000
        if (diff < minute) return '刚刚'
        if (diff < 60 * minute) return Math.floor(diff / minute) + ' 分钟前'
        if (diff < 24 * 60 * minute) return Math.floor(diff / (60 * minute)) + ' 小时前'
        return new Date(ts).toLocaleDateString()
      }

      const inputStyle = {
        width: '100%', padding: '7px 10px', borderRadius: '8px',
        border: `1px solid ${THEME.line}`, background: THEME.surface,
        color: THEME.ink, fontFamily: 'inherit', fontSize: '12.5px',
        outline: 'none', boxSizing: 'border-box',
      }
      const fieldLabel = { fontSize: '11.5px', color: THEME.inkSoft, margin: '12px 0 4px' }
      const rowAction = {
        padding: '2px 8px', borderRadius: '7px', fontSize: '11px', cursor: 'pointer',
        border: `1px solid ${THEME.line}`, background: 'transparent', color: THEME.inkSoft,
        fontFamily: 'inherit',
      }

      /** Free-form tag editor: type + Enter makes a chip; click a chip to remove;
       *  quick chips offer every tag already in use. */
      function TagEditor(props) {
        const { tags, onChange, suggestions } = props
        const [draft, setDraft] = react.useState('')
        const addTag = function (raw) {
          const tag = raw.trim()
          if (tag === '' || tags.indexOf(tag) >= 0) return
          onChange(tags.concat([tag]))
        }
        return h('div', null,
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
            tags.map(function (tag) {
              return h('span', { key: tag, style: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 9px', borderRadius: '999px', fontSize: '11px', border: `1px solid ${THEME.accent}`, color: THEME.accent, background: THEME.active } },
                tag,
                h('span', { style: { cursor: 'pointer', padding: '0 2px' }, onClick: function () { onChange(tags.filter(function (t) { return t !== tag })) } }, '×'),
              )
            }),
            h('input', {
              value: draft, placeholder: '输入标签后回车',
              onChange: function (e) { setDraft(e.target.value) },
              onKeyDown: function (e) {
                if (e.key === 'Enter') { e.preventDefault(); addTag(draft); setDraft('') }
                if (e.key === 'Backspace' && draft === '' && tags.length > 0) onChange(tags.slice(0, -1))
              },
              style: Object.assign({}, inputStyle, { width: '160px', padding: '4px 9px', fontSize: '11.5px' }),
            }),
          ),
          suggestions.length > 0
            ? h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px', alignItems: 'center' } },
              h('span', { style: { fontSize: '10.5px', color: THEME.inkFaint } }, '已有：'),
              suggestions.filter(function (tag) { return tags.indexOf(tag) < 0 }).map(function (tag) {
                return h('button', {
                  key: tag, type: 'button',
                  onClick: function () { addTag(tag) },
                  style: { padding: '1px 8px', borderRadius: '999px', fontSize: '10.5px', cursor: 'pointer', border: `1px solid ${THEME.line}`, background: 'transparent', color: THEME.inkFaint },
                }, '+ ' + tag)
              }),
            )
            : null,
        )
      }

      /** Create/edit form shared by the page and the save-as-prompt dialogs.
       *  `asNew` renders the create action with prefilled fields (save a sent
       *  message or the composer draft as a NEW prompt). */
      function PromptEditor(props) {
        const initial = props.asNew === true ? undefined : props.initial
        const prefill = props.initial
        const [title, setTitle] = react.useState(initial ? initial.title : (prefill ? prefill.title : ''))
        const [content, setContent] = react.useState(initial ? initial.content : (prefill ? prefill.content : ''))
        const [note, setNote] = react.useState(initial && initial.note || '')
        const [tags, setTags] = react.useState(initial ? initial.tags.slice() : (prefill && prefill.tags ? prefill.tags.slice() : []))
        const [busy, setBusy] = react.useState(false)
        const [error, setError] = react.useState(undefined)
        const canSave = title.trim() !== '' && content.trim() !== '' && !busy

        const save = async function () {
          setBusy(true)
          setError(undefined)
          try {
            if (initial) await api('prompts.update', { id: initial.id, patch: { title: title.trim(), content: content, note: note.trim() === '' ? undefined : note.trim(), tags: tags } })
            else await api('prompts.create', { title: title.trim(), content: content, note: note.trim() === '' ? undefined : note.trim(), tags: tags })
            await props.store.refresh()
            props.onDone()
          } catch (e) {
            setError(String(e && e.message || e))
            setBusy(false)
          }
        }

        return h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', overflowY: 'auto', padding: '14px 16px 24px', maxWidth: '760px', width: '100%', margin: '0 auto' } },
          h('div', { style: fieldLabel }, '标题 *'),
          h('input', { value: title, onChange: function (e) { setTitle(e.target.value) }, placeholder: '给这条提示词起个名字', style: inputStyle }),
          h('div', { style: fieldLabel }, '内容 *'),
          h('textarea', { value: content, onChange: function (e) { setContent(e.target.value) }, rows: 10, placeholder: '提示词正文，插入时会替换输入框中的 / 触发词', style: Object.assign({}, inputStyle, { resize: 'vertical', lineHeight: 1.6 }) }),
          h('div', { style: fieldLabel }, '备注'),
          h('input', { value: note, onChange: function (e) { setNote(e.target.value) }, placeholder: '这条提示词的用途、适用场景（可选）', style: inputStyle }),
          h('div', { style: fieldLabel }, '标签'),
          h(TagEditor, { tags: tags, onChange: setTags, suggestions: props.allTags }),
          error ? h('div', { style: { color: THEME.danger, fontSize: '11.5px', marginTop: '10px' } }, error) : null,
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' } },
            h('button', { type: 'button', onClick: props.onCancel, style: ghostButton }, '取消'),
            h('button', { type: 'button', disabled: !canSave, onClick: function () { void save() }, style: Object.assign({}, primaryButton, canSave ? {} : { opacity: 0.5, cursor: 'default' }) }, initial ? '保存更新' : (props.asNew === true ? '保存' : '添加')),
          ),
        )
      }

      /** The Prompts management tab inside the dsh-agent-profile 拓展 page.
       *  Fills the tab body the extensions page gives it: no fixed
       *  positioning or background of its own — the page root carries the
       *  .dsp-scope/.dsp-scope-dark theme layer and the center-track
       *  geometry, so light/dark tokens resolve without extra wiring. */
      function PromptsTab(props) {
        const store = props.store
        const state = react.useSyncExternalStore(store.subscribe, store.getSnapshot)
        const [query, setQuery] = react.useState('')
        const [selectedTags, setSelectedTags] = react.useState([])
        const [matchAll, setMatchAll] = react.useState(false)
        const [tagInput, setTagInput] = react.useState('')
        const [editing, setEditing] = react.useState(undefined)
        react.useEffect(function () { store.refresh() }, [])

        const prompts = state.prompts || []
        const tagSet = new Set(selectedTags)
        const rows = filterPrompts(prompts, query, tagSet, matchAll).slice().sort(function (a, b) { return b.updatedAt - a.updatedAt })
        const allTags = []
        prompts.forEach(function (p) {
          p.tags.forEach(function (tag) { if (allTags.indexOf(tag) < 0) allTags.push(tag) })
        })

        const toggleTag = function (tag) {
          setSelectedTags(function (prev) {
            const index = prev.indexOf(tag)
            if (index >= 0) return prev.filter(function (t) { return t !== tag })
            return prev.concat([tag])
          })
        }

        return h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderBottom: `1px solid ${THEME.line}`, flex: 'none' } },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700, color: THEME.ink } }, '✦ Prompts 提示词'),
            h('span', { style: { fontSize: '11px', color: THEME.inkFaint } }, String(prompts.length) + ' 条'),
            h('span', { style: { flex: 1 } }),
            h('button', { type: 'button', onClick: function () { setEditing('new') }, style: primaryButton }, '+ 添加'),
            h('button', { type: 'button', onClick: function () { store.refresh() }, style: ghostButton }, '刷新'),
            h('input', {
              className: 'prp-search',
              placeholder: '搜索 标题/内容/备注',
              value: query,
              onChange: function (e) { setQuery(e.target.value) },
              style: { width: '220px', padding: '5px 10px', borderRadius: '8px', border: `1px solid ${THEME.line}`, background: THEME.surface, color: THEME.ink, fontFamily: 'inherit', fontSize: '12px', outline: 'none' },
            }),
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderBottom: `1px solid ${THEME.line}`, flexWrap: 'wrap', flex: 'none' } },
            h('span', { style: { fontSize: '11px', color: THEME.inkFaint } }, '标签'),
            allTags.length === 0 ? h('span', { style: { fontSize: '11px', color: THEME.inkFaint } }, '（暂无）') : null,
            allTags.map(function (tag) {
              const selected = selectedTags.indexOf(tag) >= 0
              return h('button', {
                key: tag, type: 'button',
                onClick: function () { toggleTag(tag) },
                style: {
                  padding: '2px 9px', borderRadius: '999px', fontSize: '11px', cursor: 'pointer',
                  border: `1px solid ${selected ? THEME.accent : THEME.line}`,
                  background: selected ? THEME.active : 'transparent',
                  color: selected ? THEME.accent : THEME.inkSoft,
                },
              }, tag)
            }),
            selectedTags.length > 1 ? h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: THEME.inkSoft, marginLeft: '8px', cursor: 'pointer' } },
              h('input', { type: 'checkbox', checked: matchAll, onChange: function (e) { setMatchAll(e.target.checked) } }),
              '匹配全部',
            ) : null,
            selectedTags.length > 0 || tagInput !== '' ? h('button', { type: 'button', onClick: function () { setSelectedTags([]); setTagInput('') }, style: Object.assign({}, ghostButton, { padding: '2px 8px', fontSize: '11px' }) }, '清除筛选') : null,
          ),
          editing !== undefined
            ? h(PromptEditor, {
              store: store, allTags: allTags,
              initial: editing === 'new' ? undefined : editing,
              onDone: function () { setEditing(undefined) },
              onCancel: function () { setEditing(undefined) },
            })
            :           h('div', { style: { flex: '1 1 auto', overflowY: 'auto', padding: '10px 16px 24px' } },
            state.error !== undefined
              ? h('div', { style: { color: THEME.danger, fontSize: '12px', padding: '12px 0' } }, '加载失败：' + state.error)
              : null,
            state.loaded && prompts.length === 0
              ? h('div', { style: { textAlign: 'center', color: THEME.inkFaint, fontSize: '12px', padding: '48px 0', lineHeight: 1.8 } },
                '还没有提示词',
                h('br'), '在会话里发送消息后可一键保存，或点击下方按钮添加',
              )
              : null,
            rows.map(function (p) {
              return h('div', {
                key: p.id,
                style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${THEME.line}`, marginBottom: '8px', background: THEME.surface },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                  h('span', { style: { fontWeight: 600, fontSize: '13px', color: THEME.ink } }, p.title),
                  h('span', {
                    title: p.favorite ? '取消收藏' : '收藏',
                    style: { color: p.favorite ? '#f5a623' : THEME.inkFaint, fontSize: '12px', cursor: 'pointer' },
                    onClick: function () { void api('prompts.update', { id: p.id, patch: { favorite: !p.favorite } }).then(function () { return store.refresh() }) },
                  }, p.favorite ? '★' : '☆'),
                  h('span', { style: { flex: 1 } }),
                  h('span', { style: { fontSize: '11px', color: THEME.inkFaint } }, (p.useCount > 0 ? '用 ' + p.useCount + ' 次 · ' : '') + relativeTime(p.updatedAt)),
                  h('button', { type: 'button', style: rowAction, onClick: function () { setEditing(p) } }, '编辑'),
                  h('button', { type: 'button', style: rowAction, onClick: function () { void api('prompts.create', { title: p.title + ' 副本', content: p.content, note: p.note, tags: p.tags.slice() }).then(function () { return store.refresh() }) } }, '副本'),
                  h('button', { type: 'button', style: Object.assign({}, rowAction, { color: THEME.danger }), onClick: function () { if (window.confirm('删除提示词「' + p.title + '」？')) void api('prompts.delete', { id: p.id }).then(function () { return store.refresh() }) } }, '删除'),
                  h('span', { style: { flex: 1 } }),
                  h('span', { style: { fontSize: '11px', color: THEME.inkFaint } }, relativeTime(p.updatedAt)),
                ),
                h('div', { style: { fontSize: '12px', color: THEME.inkSoft, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, firstLine(p.content)),
                p.note ? h('div', { style: { fontSize: '11px', color: THEME.inkFaint } }, '备注：' + p.note) : null,
                h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
                  p.tags.map(function (tag) {
                    return h('span', { key: tag, style: { padding: '1px 7px', borderRadius: '999px', fontSize: '10.5px', border: `1px solid ${THEME.line}`, color: THEME.inkFaint } }, tag)
                  }),
                ),
              )
            }),
          ),
        )
      }

      /** Sort for the panel browse list: favorites, then recent use, then
       *  recent update. */
      function panelSort(list) {
        return list.slice().sort(function (a, b) {
          const fa = a.favorite ? 1 : 0
          const fb = b.favorite ? 1 : 0
          if (fa !== fb) return fb - fa
          const la = a.lastUsedAt || 0
          const lb = b.lastUsedAt || 0
          if (la !== lb) return lb - la
          return b.updatedAt - a.updatedAt
        })
      }

      /** The dock panel: an in-layout row above the composer card (never
       *  covers the message flow or the input box). Browse shows the library;
       *  edit holds a TEMP COPY — inserting writes the edited text into the
       *  composer, never back to the stored prompt. */
      function PromptsDockPanel(props) {
        const state = react.useSyncExternalStore(props.panelStore.subscribe, props.panelStore.getSnapshot)
        const store = props.store
        const promptsState = react.useSyncExternalStore(store.subscribe, store.getSnapshot)
        const [dark, setDark] = react.useState(isDark)
        react.useEffect(function () {
          const stop = ctxOnThemeChange(function () { setDark(isDark()) })
          return stop
        }, [])
        const listRef = react.useRef(null)

        const all = promptsState.prompts || []
        const tagSet = new Set(state.filterTags)
        const visible = panelSort(filterPrompts(all, state.query, tagSet, state.matchAll))

        react.useEffect(function () {
          if (!state.open) return undefined
          const onKey = function (e) {
            if (e.key === 'Escape') {
              e.preventDefault(); e.stopPropagation()
              props.panelStore.close()
              return
            }
            if (state.mode !== 'browse') return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              props.panelStore.moveHighlight(e.key === 'ArrowDown' ? 1 : -1, visible.length)
              return
            }
            if (e.key === 'Enter' && !e.isComposing && visible.length > 0) {
              e.preventDefault()
              props.panelStore.editPending(visible[state.highlight] || visible[0])
            }
          }
          document.addEventListener('keydown', onKey, true)
          return function () { document.removeEventListener('keydown', onKey, true) }
        }, [state.open, state.mode, state.highlight, visible.length])

        react.useEffect(function () {
          const el = listRef.current
          if (el === null) return
          const row = el.querySelector('[data-highlight="1"]')
          if (row) row.scrollIntoView({ block: 'nearest' })
        }, [state.highlight])

        // Track the composer card's width while the panel is open: the dock
        // row spans the full composer stack, but the card itself can be
        // narrower and centered — match the card so the panel reads as part
        // of it. (Hooks stay above the early return below; hook order is
        // stable across open/close.)
        const [cardWidth, setCardWidth] = react.useState(undefined)
        react.useEffect(function () {
          if (!state.open) return undefined
          const measure = function () {
            const tools = findComposerTools()
            if (tools === null) return
            let anc = tools
            for (let k = 0; k < 8 && anc !== null; k++) {
              anc = anc.parentElement
              if (anc !== null && anc.querySelector(':scope textarea') !== null) break
            }
            if (anc !== null && anc.offsetWidth > 0) setCardWidth(anc.offsetWidth)
          }
          measure()
          window.addEventListener('resize', measure)
          return function () { window.removeEventListener('resize', measure) }
        }, [state.open, state.mode])

        if (!state.open) return null

        const panelStyle = {
          margin: '0 auto 6px', borderRadius: '12px',
          width: cardWidth === undefined ? undefined : cardWidth + 'px',
          maxWidth: '100%', boxSizing: 'border-box',
          // The composer stack is a flex container that shrinks its children
          // to share the seat height — without this the panel collapses to a
          // sliver (unclickable rows, cut-off editor).
          flexShrink: 0, flexGrow: 0,
          border: '1px solid ' + THEME.line, background: THEME.surface,
          boxShadow: '0 8px 28px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column', maxHeight: '340px',
          overflow: 'hidden',
        }

        // ---- edit mode ----
        if (state.mode === 'edit' && state.pending !== undefined) {
          const prompt = state.pending.prompt
          return h('div', { className: dark ? 'dsp-scope dsp-scope-dark' : 'dsp-scope', style: panelStyle },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px 0' } },
              h('span', { style: { fontWeight: 600, fontSize: '12.5px', color: THEME.ink } }, prompt.title),
              h('span', { style: { fontSize: '10.5px', color: THEME.inkFaint } }, '临时编辑，不改动原提示词'),
              h('span', { style: { flex: 1 } }),
              h('button', { type: 'button', style: rowAction, onClick: function () { props.panelStore.backToBrowse() } }, '‹ 返回列表'),
            ),
            h('textarea', {
              autoFocus: true,
              value: state.editedContent,
              onChange: function (e) { props.panelStore.setEdited(e.target.value) },
              style: { margin: '8px 12px', padding: '8px 10px', borderRadius: '8px', border: '1px solid ' + THEME.line, background: THEME.surface, color: THEME.ink, fontFamily: 'inherit', fontSize: '12.5px', lineHeight: 1.6, resize: 'vertical', minHeight: '96px', outline: 'none', boxSizing: 'border-box' },
            }),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', padding: '0 12px 10px' } },
              h('button', { type: 'button', style: rowAction, onClick: function () { props.panelStore.close() } }, '取消'),
              h('button', {
                type: 'button', style: rowAction,
                onClick: function () {
                  void api('prompts.create', { title: prompt.title + ' 副本', content: state.editedContent, note: prompt.note, tags: prompt.tags.slice() })
                    .then(function () { return store.refresh() })
                    .then(function () { props.panelStore.close() })
                },
              }, '另存为'),
              h('button', {
                type: 'button', style: rowAction,
                onClick: function () {
                  void api('prompts.update', { id: prompt.id, patch: { content: state.editedContent } })
                    .then(function () { return store.refresh() })
                    .then(function () { props.panelStore.close() })
                },
              }, '保存更新'),
              h('button', { type: 'button', style: primaryButton, onClick: function () { props.insert(prompt) } }, '插入'),
            ),
          )
        }

        // ---- save mode: pre-filled create form for the composer draft ----
        if (state.mode === 'save' && state.pending !== undefined) {
          return h('div', { className: dark ? 'dsp-scope dsp-scope-dark' : 'dsp-scope', style: panelStyle },
            h(PromptEditor, {
              store: store,
              allTags: (promptsState.prompts || []).reduce(function (acc, p) {
                p.tags.forEach(function (t) { if (acc.indexOf(t) < 0) acc.push(t) })
                return acc
              }, []),
              initial: state.pending.prompt, asNew: true,
              onDone: function () { props.panelStore.close() },
              onCancel: function () { props.panelStore.close() },
            }),
          )
        }

        // ---- browse mode ----
        return h('div', { className: dark ? 'dsp-scope dsp-scope-dark' : 'dsp-scope', style: panelStyle },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid ' + THEME.line, flexWrap: 'wrap' } },
            h('input', {
              autoFocus: true,
              placeholder: '搜索提示词（标题/内容/备注）',
              value: state.query,
              onChange: function (e) { props.panelStore.setQuery(e.target.value) },
              style: { flex: '1 1 160px', minWidth: '140px', padding: '5px 9px', borderRadius: '8px', border: '1px solid ' + THEME.line, background: THEME.surface, color: THEME.ink, fontFamily: 'inherit', fontSize: '12px', outline: 'none', boxSizing: 'border-box' },
            }),
            h('span', { style: { fontSize: '10.5px', color: THEME.inkFaint } }, '↑↓ 选择 · Enter 编辑 · Esc 关闭'),
          ),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 12px 0', gap: '8px' } },
            props.sentSave !== undefined
              ? h('button', { type: 'button', style: rowAction, onClick: props.sentSave, title: '把本会话最近发送的一条消息存为提示词' }, '保存上一条发送的消息')
              : h('span', null),
            props.draftSave !== undefined && props.input !== undefined && props.input.draft.trim() !== ''
              ? h('button', { type: 'button', style: rowAction, onClick: props.draftSave }, '将当前草稿存为提示词')
              : null,
          ),
          h('div', { ref: listRef, style: { overflowY: 'auto', padding: '6px 8px 10px' } },
            visible.length === 0
              ? h('div', { style: { textAlign: 'center', color: THEME.inkFaint, fontSize: '12px', padding: '22px 0' } },
                all.length === 0 ? '还没有提示词——先在拓展页添加，或发送消息后保存一条' : '没有匹配的提示词')
              : null,
            visible.map(function (p, index) {
              const highlighted = index === state.highlight
              return h('div', {
                key: p.id, 'data-highlight': highlighted ? '1' : '0',
                onMouseEnter: function () { props.panelStore.setHighlight(index) },
                onClick: function () { props.panelStore.editPending(p) },
                style: {
                  display: 'flex', flexDirection: 'column', gap: '2px',
                  padding: '7px 10px', borderRadius: '8px', cursor: 'pointer',
                  background: highlighted ? THEME.active : 'transparent',
                  border: '1px solid ' + (highlighted ? THEME.accent : 'transparent'),
                  marginBottom: '4px',
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                  p.favorite ? h('span', { style: { color: '#f5a623', fontSize: '11px' } }, '★') : null,
                  h('span', { style: { fontWeight: 600, fontSize: '12.5px', color: THEME.ink } }, p.title),
                  h('span', { style: { flex: 1 } }),
                  h('span', { style: { fontSize: '10.5px', color: THEME.inkFaint } }, relativeTime(p.updatedAt)),
                ),
                h('div', { style: { fontSize: '11.5px', color: THEME.inkSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, firstLine(p.content)),
                p.tags.length > 0
                  ? h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
                    p.tags.map(function (tag) {
                      return h('span', { key: tag, style: { padding: '0 6px', borderRadius: '999px', fontSize: '10px', border: '1px solid ' + THEME.line, color: THEME.inkFaint } }, tag)
                    }))
                  : null,
              )
            }),
          ),
        )
      }

      /** Composer tools-row discovery, build-agnostic. The row is the parent
       *  div of the commands (+) button — the only textless listbox-trigger
       *  button inside a container that also holds the composer textarea.
       *  Verified against the shipped composer: [+ button][modes …] with the
       *  context-occupancy button riding between them when present. */
      function findComposerTools() {
        const candidates = document.querySelectorAll('button[aria-haspopup="listbox"]')
        for (let i = 0; i < candidates.length; i++) {
          const button = candidates[i]
          if (button.querySelector(':scope svg') === null) continue
          if ((button.textContent || '').trim() !== '') continue
          let tools = button.parentElement
          while (tools !== null && tools.tagName !== 'DIV') tools = tools.parentElement
          if (tools === null) continue
          let ancestor = tools
          for (let k = 0; k < 6 && ancestor !== null; k++) {
            if (ancestor.querySelector(':scope textarea') !== null) return tools
            ancestor = ancestor.parentElement
          }
        }
        return null
      }

      /** Mount the icon-only quick button inside the composer tools row,
       *  immediately before the modes group — visually right of the
       *  context-occupancy button, or right of the + button when the context
       *  control is absent. Imperative DOM by design: the tools row offers no
       *  render slot, and a React portal into the shell's row fights its
       *  reconciliation; one static node this plugin owns and removes is
       *  sturdier across session switches and rebuilds. */
      function mountComposerButton(onOpen) {
        const tools = findComposerTools()
        if (tools === null) return null
        document.querySelectorAll('.prp-composer-btn').forEach(function (el) { el.remove() })
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'prp-composer-btn'
        button.title = '提示词（Prompts）'
        button.setAttribute('aria-label', '提示词（Prompts）')
        button.textContent = '✦'
        button.addEventListener('click', function (event) {
          event.preventDefault()
          event.stopPropagation()
          onOpen()
        })
        const last = tools.lastElementChild
        if (last !== null && last.tagName === 'DIV') tools.insertBefore(button, last)
        else tools.appendChild(button)
        return button
      }

      /** Insert one prompt's (possibly edited) text into the composer:
       *  Path A replaces the menu-time trigger token span under draftRev CAS;
       *  Path B falls back to a caret-anchored splice computed from the live
       *  draft snapshot. Never touches any other part of the draft. */
      function makeInsertPrompt(rootCtxRef, panelStoreRef, apiRef) {
        return function insertPrompt(prompt) {
          const panel = panelStoreRef()
          const snap = panel.getSnapshot()
          const text = snap.editedContent !== undefined ? snap.editedContent : prompt.content
          const span = snap.pending !== undefined ? snap.pending.span : undefined
          panel.close()
          let actx
          try { actx = rootCtxRef().get('sessions').scope(snap.sessionId) } catch (e) { actx = undefined }
          if (actx === undefined) return
          let conversation
          try { conversation = actx.get('conversation') } catch (e) { conversation = undefined }
          if (conversation === undefined) return
          const facade = conversation.input.for(actx)
          // Path A: fresh span — the input machine CAS-checks draftRev and
          // splices the token in place, caret after the text.
          if (span !== undefined && actx.bail(actx, 'slash/input-insert-text', { text: text, span: span }) === true) {
            void apiRef()('prompts.use', { id: prompt.id })
            refocusComposer()
            return
          }
          // Path B: stale or absent span — recompute against the live draft.
          // The machine leaves caret undefined for writes without an explicit
          // caret ("native caret behavior"); fall back to draft end.
          const input = facade.state.getSnapshot()
          const caretAt = typeof input.caret === 'number' ? input.caret : input.draft.length
          let at = { start: caretAt, end: caretAt }
          if (span !== undefined && span.end <= input.draft.length && input.draft.charAt(span.start) === '/') {
            at = { start: span.start, end: span.end }
          }
          const next = input.draft.slice(0, at.start) + text + input.draft.slice(at.end)
          facade.setDraft(next, undefined, at.start + text.length)
          void apiRef()('prompts.use', { id: prompt.id })
          refocusComposer()
        }
      }

      function refocusComposer() {
        const ta = document.querySelector('textarea')
        if (ta !== null) ta.focus()
      }

      /** Modal save-as-prompt dialog over the conversation (turn-tail chip). */
      function SavePromptDialog(props) {
        const [dark, setDark] = react.useState(isDark)
        react.useEffect(function () {
          const stop = ctxOnThemeChange(function () { setDark(isDark()) })
          return stop
        }, [])
        const allTags = (store.getSnapshot().prompts || []).reduce(function (acc, p) {
          p.tags.forEach(function (t) { if (acc.indexOf(t) < 0) acc.push(t) })
          return acc
        }, [])
        return h('div', {
          className: dark ? 'dsp-scope dsp-scope-dark' : 'dsp-scope',
          style: { position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' },
          onClick: function (e) { if (e.target === e.currentTarget) props.onClose() },
        },
          h('div', { style: { width: '440px', maxHeight: '80vh', overflowY: 'auto', borderRadius: '14px', border: '1px solid ' + THEME.line, background: THEME.surface, padding: '16px', boxShadow: '0 12px 32px rgba(0,0,0,0.35)' } },
            h('div', { style: { fontSize: '13px', fontWeight: 600, color: THEME.ink, marginBottom: '4px' } }, '保存为提示词'),
            h(PromptEditor, {
              store: store, allTags: allTags,
              initial: { title: firstLine(props.content).slice(0, 40), content: props.content, tags: [] }, asNew: true,
              onDone: props.onClose,
              onCancel: props.onClose,
            }),
          ),
        )
      }

      // ---- apply-scope wiring (set inside apply, read by the components above) ----
      let store = null
      let api = null
      let panelStore = null
      let officialApi = null

      /** User message content is a block array; join the text blocks the same
       *  way the chat bubble does. */
      function userContentText(content) {
        if (typeof content === 'string') return content
        if (Array.isArray(content)) {
          return content
            .filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string' })
            .map(function (b) { return b.text })
            .join('')
        }
        return ''
      }

      /** Page session.history backwards for the last user prompt before
       *  beforeSeq (the message that opened the tailed turn). */
      function findTurnUserText(sessionId, beforeSeq) {
        const bounded = typeof beforeSeq === 'number' && isFinite(beforeSeq)
        let before = beforeSeq
        const attempt = function (page) {
          if (page >= 4 || officialApi === undefined || officialApi === null) return Promise.resolve(undefined)
          const request = bounded ? { sessionId: sessionId, beforeSeq: before, maxMessages: 100 } : { sessionId: sessionId, maxMessages: 60 }
          return officialApi.sessions.history(request).then(function (response) {
            const result = response.result
            if (!result.ok) return undefined
            const events = result.value.events
            let best = undefined
            for (let i = 0; i < events.length; i++) {
              const ev = events[i].event
              const match = ev.type === 'user/message' && ev.data && ev.data.source && ev.data.source.kind === 'user'
                && (!bounded || ev.seq < beforeSeq)
              if (match) best = ev
            }
            if (best !== undefined) return userContentText(best.data.content)
            if (!result.value.hasMore || events.length === 0) return undefined
            before = events[0].event.seq
            return attempt(page + 1)
          }).catch(function () { return undefined })
        }
        return attempt(0)
      }
      function ctxOnThemeChange(listener) {
        try { return rootCtx.on('theme/change', listener) } catch (error) { return undefined }
      }
      let rootCtx = null

      /** Subagent sessions suppress the prompts surfaces, matching the
       *  official slash-command behavior (ui-commands subagentAddress). */
      function isSubagentSession(sessionId) {
        if (sessionId === undefined || sessionId === null) return false
        try {
          const sessions = rootCtx.get('sessions')
          if (sessions === undefined || typeof sessions.subagentAddress !== 'function') return false
          return sessions.subagentAddress(sessionId) !== undefined
        } catch (e) { return false }
      }

      return {
        inject: ['slots', 'inputTriggers'],
        apply: function (ctx) {
          rootCtx = ctx
          injectStyles()
          api = createApi()
          try { officialApi = ctx.get('connection').api } catch (e) { officialApi = undefined }
          store = createPromptsStore(api)
          store.refresh()
          panelStore = createPanelStore()
          const inputTriggers = ctx.get('inputTriggers')
          if (inputTriggers === undefined) throw new Error('dsh-prompts: inputTriggers service unavailable')
          ctx.effect(function () {
            return inputTriggers.registerSource({
              trigger: '/',
              name: 'prompts',
              showGroupTitle: true,
              warm: function () { store.refresh() },
              candidates: function (session, req) {
                if (isSubagentSession(session.sessionId)) return Promise.resolve([])
                const prompts = store.getSnapshot().prompts || []
                const query = req.query.trim().toLowerCase()
                const rows = []
                // The panel entry rides the same fuzzy prefix filter as any
                // candidate: visible on empty query and while 'prompts' still
                // matches what the user typed after '/'.
                if ('prompts'.includes(query)) {
                  rows.push({ name: 'prompts', description: '打开提示词面板', value: '__prompts__' })
                }
                prompts
                  .filter(function (p) { return p.title.toLowerCase().includes(query) })
                  .slice(0, 8)
                  .forEach(function (p) { rows.push({ name: p.title, description: firstLine(p.content), value: p.id }) })
                return Promise.resolve(rows)
              },
              onPick: function (pick) {
                const value = pick.candidate.value
                if (value === '__prompts__') {
                  panelStore.openBrowse(pick.session.sessionId, pick.span)
                  return 'handled'
                }
                const prompt = (store.getSnapshot().prompts || []).find(function (p) { return p.id === value })
                if (prompt === undefined) return undefined
                panelStore.openEdit(prompt, pick.session.sessionId, pick.span)
                return 'handled'
              },
            })
          }, 'prompts: slash source')
          // The management tab lives in the dsh-agent-profile 拓展 page: that
          // page declares agent-profile.extensions.tab and renders each
          // contributed entry as one tab (label in its tab strip, content
          // mounted through renderSlot(only: id)). The page root carries the
          // .dsp-scope/.dsp-scope-dark layer, so this tab is themed in both
          // schemes with no wiring of its own. The inject waits on the
          // declaration: without dsh-agent-profile the contribution stays
          // pending instead of failing.
          ctx.slots.inject('agent-profile.extensions.tab', function () {
            return ctx.slots.register({
              name: 'agent-profile.extensions.tab',
              id: 'prompts',
              order: 90,
              label: '提示词',
            }, function PromptsTabEntry() {
              return h(PromptsTab, { store: store })
            })
          })
          const insertPrompt = makeInsertPrompt(
            function () { return rootCtx },
            function () { return panelStore },
            function () { return api },
          )
          ctx.slots.inject('conversation.chat.turnTail', function () {
            return ctx.slots.register({
              name: 'conversation.chat.turnTail',
              id: 'prompts-save-chip',
              order: 90,
              select: function () { return true },
            }, function SavePromptChip(props) {
              if (isSubagentSession(props.sessionId)) return null
              const [content, setContent] = react.useState(undefined)
              const [looking, setLooking] = react.useState(false)
              // The turn's user message: prefer the live node store (when the
              // window covers it), else page session.history at click time.
              const userNode = props.useSession(function (snapshot) {
                let best = undefined
                let bestSeq = -1
                const values = snapshot.chat.nodes.values()
                for (let i = 0; i < values.length; i++) {
                  const n = values[i]
                  if (n === undefined || n === null || n.kind !== 'user') continue
                  const seq = n.data && typeof n.data.seq === 'number' ? n.data.seq : n.anchorSeq
                  if (typeof seq === 'number' && seq < props.seq && seq > bestSeq) { best = n; bestSeq = seq }
                }
                return best
              })
              const text = userNode !== undefined && userNode !== null
                ? userContentText(userNode.data && userNode.data.content)
                : undefined
              const chipStyle = {
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '2px 8px', borderRadius: '7px', fontSize: '11px',
                border: '1px solid ' + THEME.line, background: 'transparent',
                color: THEME.inkSoft, cursor: 'pointer', fontFamily: 'inherit',
              }
              return h('span', null,
                h('button', {
                  type: 'button',
                  disabled: looking,
                  onClick: function () {
                    if (text !== undefined && text.trim() !== '') { setContent(text); return }
                    setLooking(true)
                    void findTurnUserText(props.sessionId, props.seq).then(function (found) {
                      setLooking(false)
                      if (found !== undefined && found.trim() !== '') setContent(found)
                    })
                  },
                  style: chipStyle,
                }, looking ? '… 保存为提示词' : '✦ 保存为提示词'),
                content !== undefined ? h(SavePromptDialog, { content: content, onClose: function () { setContent(undefined) } }) : null,
              )
            })
          })
          ctx.slots.inject('conversation.input.left', function () {
            return ctx.slots.register({ name: 'conversation.input.left', id: 'prompts-button' }, function PromptsButton(props) {
              if (isSubagentSession(props.sessionId)) return null
              // The visible button lives inside the composer's tools row (see
              // mountComposerButton), not in this footer seat — this component
              // only owns the mount lifecycle per session.
              react.useEffect(function () {
                let attempts = 0
                let timer = undefined
                const open = function () { panelStore.openBrowse(props.sessionId, undefined) }
                const tryMount = function () {
                  const mounted = mountComposerButton(open)
                  if (mounted === null && attempts < 12) {
                    attempts += 1
                    timer = setTimeout(tryMount, 250)
                  }
                }
                tryMount()
                return function () {
                  if (timer !== undefined) clearTimeout(timer)
                  document.querySelectorAll('.prp-composer-btn').forEach(function (el) { el.remove() })
                }
              }, [props.sessionId])
              return null
            })
          })
          ctx.slots.inject('conversation.input.dock', function () {
            return ctx.slots.register({
              name: 'conversation.input.dock',
              id: 'prompts-panel',
              order: 0,
            }, function DockPanel(props) {
              if (isSubagentSession(props.sessionId)) return null
              return h(PromptsDockPanel, {
                panelStore: panelStore, store: store, insert: insertPrompt,
                input: props.input, sessionId: props.sessionId,
                draftSave: function () { panelStore.openSaveDraft(props.sessionId, props.input.draft) },
                sentSave: function () {
                  void findTurnUserText(props.sessionId, Infinity).then(function (text) {
                    if (text !== undefined && text.trim() !== '') panelStore.openSaveDraft(props.sessionId, text)
                  })
                },
              })
            })
          })
        },
        dispose: function () {},
      }
    },
  })
})()
