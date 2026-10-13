/**
 * Prompt library web API: exposes the prompts store to the browser as JSON
 * over HTTP under the `/prompts-api` prefix, alongside the official `/api`
 * gateway.
 *
 * The official apiproxy owns a static `RpcMethodMap` that out-of-tree plugins
 * cannot extend, so this bundle registers its own prefix route on the shared
 * webserver — the same pattern `dsh-agent-profile` uses for `/roster-api`.
 * The browser half calls these endpoints directly; no official gateway
 * surface is modified.
 *
 * Protocol (all POST, JSON bodies; the browser envelope
 * `{ type, rpcId, method, payload }` is unwrapped, bare business bodies are
 * accepted):
 *   POST /prompts-api/prompts.list    {}                          -> { prompts: Prompt[] }
 *   POST /prompts-api/prompts.create  {title, content, note?, tags?}   -> { prompt }
 *   POST /prompts-api/prompts.update  {id, patch}                 -> { prompt }
 *   POST /prompts-api/prompts.delete  {id}                        -> { deleted: true }
 *   POST /prompts-api/prompts.use     {id}                        -> { prompt }
 *
 * Responses: `{ ok: true, result }` or `{ ok: false, error: { code, message } }`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import { PromptsStore } from './store.ts'

/** Mount the /prompts-api prefix route with its store. */
export const inject = ['webServer']

export function apply(ctx: Context): void {
  const store = new PromptsStore(join(resolveDshHome(), 'prompts.json'))
  const prefix = '/prompts-api'
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: prefix,
    handler: (req, res) => { void handle(req, res, prefix, store) },
  }), 'prompts-web-api: prefix route')
}

/** Dispatch one request: parse the method from the path tail, then the body. */
export async function handle(req: IncomingMessage, res: ServerResponse, prefix: string, store: PromptsStore): Promise<void> {
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: { code: 'bad-request', message: 'prompts-api: POST required' } })
    return
  }
  const pathname = new URL(req.url ?? '/', 'http://prompts.local').pathname
  const method = pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length + 1) : ''
  if (method === '') {
    send(res, 404, { ok: false, error: { code: 'bad-request', message: `prompts-api: unknown path ${pathname}` } })
    return
  }
  let body: unknown
  try {
    body = JSON.parse(await readBody(req)) as unknown
  } catch {
    send(res, 400, { ok: false, error: { code: 'bad-request', message: 'prompts-api: body must be JSON' } })
    return
  }
  // Accept both the raw business body and the JSON-RPC envelope
  // ({ type, rpcId, method, payload }): the browser client sends the
  // envelope, tests and curl may send the bare business object.
  const business = (typeof body === 'object' && body !== null && 'payload' in body)
    ? (body as { payload: unknown }).payload
    : body
  try {
    const result = dispatch(method, business, store)
    send(res, 200, { ok: true, result })
  } catch (error) {
    send(res, 200, { ok: false, error: wireError(error) })
  }
}

/** Route one method to the store; business rejections surface as throws. */
function dispatch(method: string, business: unknown, store: PromptsStore): unknown {
  switch (method) {
    case 'prompts.list':
      return { prompts: store.list() }
    case 'prompts.create': {
      const input = asRecord(business)
      return { prompt: store.create({
        title: text(input.title),
        content: text(input.content),
        note: optionalText(input.note),
        tags: optionalTags(input.tags),
      }) }
    }
    case 'prompts.update': {
      const input = asRecord(business)
      const patch = asRecord(input.patch)
      return { prompt: store.update(text(input.id), {
        title: optionalText(patch.title),
        content: optionalText(patch.content),
        note: optionalText(patch.note),
        tags: optionalTags(patch.tags),
        favorite: optionalBoolean(patch.favorite),
      }) }
    }
    case 'prompts.delete':
      return { deleted: store.delete(text(asRecord(business).id)) }
    case 'prompts.use':
      return { prompt: store.use(text(asRecord(business).id)) }
    default:
      throw new Error(`prompts: bad-request unknown method ${method}`)
  }
}

function wireError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('not-found')) return { code: 'not-found', message }
  if (message.includes('bad-request')) return { code: 'bad-request', message }
  return { code: 'internal', message }
}

function asRecord(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value)
}

function optionalTags(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(tag => text(tag)) : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : Boolean(value)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => { data += chunk })
    req.on('end', () => { resolve(data) })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
