import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle } from '../src/web-api.ts'
import { PromptsStore } from '../src/store.ts'

/** Minimal structural doubles for node:http req/res (handle uses setEncoding/on/writeHead/end only). */
interface TestReq { method?: string; url?: string; body?: unknown }
interface Collected { status: () => number; json: () => any }

function makeReq(spec: TestReq): any {
  const payload = spec.body === undefined ? '' : JSON.stringify(spec.body)
  return {
    method: spec.method ?? 'POST',
    url: spec.url,
    setEncoding() {},
    on(event: string, cb: (chunk?: string) => void) {
      if (event === 'data' && payload !== '') cb(payload)
      if (event === 'end') cb()
    },
  }
}

function makeRes(): { res: any; collected: Collected } {
  const chunks: string[] = []
  let status = 0
  const res = {
    writeHead(code: number) { status = code },
    end(body: string) { chunks.push(body) },
  }
  return {
    res,
    collected: {
      status: () => status,
      json: () => JSON.parse(chunks.join('')),
    },
  }
}

function tmpStore(): PromptsStore {
  return new PromptsStore(join(mkdtempSync(join(tmpdir(), 'prompts-api-')), 'prompts.json'))
}

describe('prompts-api handle', () => {
  it('accepts the bare business body and the browser envelope alike', async () => {
    const store = tmpStore()
    const bare = makeRes()
    await handle(makeReq({ url: '/prompts-api/prompts.create', body: { title: '裸对象', content: 'c' } }), bare.res, '/prompts-api', store)
    expect(bare.collected.json().ok).toBe(true)
    expect(bare.collected.json().result.prompt.title).toBe('裸对象')

    const enveloped = makeRes()
    await handle(
      makeReq({ url: '/prompts-api/prompts.create', body: { type: 'rpc', rpcId: '1', method: 'prompts.create', payload: { title: '信封', content: 'c' } } }),
      enveloped.res,
      '/prompts-api',
      store,
    )
    expect(enveloped.collected.json().result.prompt.title).toBe('信封')
  })

  it('maps list/create/update/use/delete onto the store', async () => {
    const store = tmpStore()
    const created = makeRes()
    await handle(makeReq({ url: '/prompts-api/prompts.create', body: { title: 't', content: 'c', tags: ['x'] } }), created.res, '/prompts-api', store)
    const id = created.collected.json().result.prompt.id as string

    const used = makeRes()
    await handle(makeReq({ url: '/prompts-api/prompts.use', body: { id } }), used.res, '/prompts-api', store)
    expect(used.collected.json().result.prompt.useCount).toBe(1)

    const updated = makeRes()
    await handle(makeReq({ url: '/prompts-api/prompts.update', body: { id, patch: { favorite: true } } }), updated.res, '/prompts-api', store)
    expect(updated.collected.json().result.prompt.favorite).toBe(true)

    const listed = makeRes()
    await handle(makeReq({ url: '/prompts-api/prompts.list', body: {} }), listed.res, '/prompts-api', store)
    expect(listed.collected.json().result.prompts).toHaveLength(1)

    const deleted = makeRes()
    await handle(makeReq({ url: '/prompts-api/prompts.delete', body: { id } }), deleted.res, '/prompts-api', store)
    expect(deleted.collected.json().result.deleted).toBe(true)
  })

  it('surfaces not-found and bad-request as {ok:false,error.code}', async () => {
    const store = tmpStore()
    const missing = makeRes()
    await handle(makeReq({ url: '/prompts-api/prompts.update', body: { id: 'nope', patch: {} } }), missing.res, '/prompts-api', store)
    expect(missing.collected.json().ok).toBe(false)
    expect(missing.collected.json().error.code).toBe('not-found')

    const invalid = makeRes()
    await handle(makeReq({ url: '/prompts-api/prompts.create', body: { title: '', content: 'c' } }), invalid.res, '/prompts-api', store)
    expect(invalid.collected.json().error.code).toBe('bad-request')

    const unknown = makeRes()
    await handle(makeReq({ url: '/prompts-api/prompts.nope', body: {} }), unknown.res, '/prompts-api', store)
    expect(unknown.collected.json().error.code).toBe('bad-request')
  })

  it('rejects non-POST and non-JSON bodies', async () => {
    const store = tmpStore()
    const get = makeRes()
    await handle(makeReq({ method: 'GET', url: '/prompts-api/prompts.list', body: {} }), get.res, '/prompts-api', store)
    expect(get.collected.status()).toBe(405)

    const bad = makeRes()
    const req = makeReq({ url: '/prompts-api/prompts.list' })
    req.on = function (event: string, cb: (chunk?: string) => void) {
      if (event === 'data') cb('{not json')
      if (event === 'end') cb()
    }
    await handle(req, bad.res, '/prompts-api', store)
    expect(bad.collected.status()).toBe(400)
  })
})
