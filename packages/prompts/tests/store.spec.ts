import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PromptsStore } from '../src/store.ts'

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'prompts-')), 'prompts.json')
}

describe('PromptsStore', () => {
  it('creates a prompt with server-side id/timestamps and useCount 0', () => {
    const store = new PromptsStore(tmpPath())
    const p = store.create({ title: '翻译', content: '把下面内容翻译成英文：', tags: ['写作'] })
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(p.useCount).toBe(0)
    expect(p.createdAt).toBe(p.updatedAt)
    expect(p.tags).toEqual(['写作'])
  })

  it('persists across reload (read-disk-on-parse)', () => {
    const path = tmpPath()
    const created = new PromptsStore(path).create({ title: 'a', content: 'b' })
    const reloaded = new PromptsStore(path)
    expect(reloaded.list().map(p => p.id)).toEqual([created.id])
  })

  it('update patches fields and bumps updatedAt, rejects unknown id', () => {
    const path = tmpPath()
    const store = new PromptsStore(path)
    const p = store.create({ title: 'a', content: 'b' })
    const updated = store.update(p.id, { content: 'c', favorite: true })
    expect(updated.content).toBe('c')
    expect(updated.favorite).toBe(true)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(p.updatedAt)
    expect(() => store.update('nope', {})).toThrowError(/not-found/)
  })

  it('use bumps useCount/lastUsedAt without touching updatedAt', () => {
    const store = new PromptsStore(tmpPath())
    const p = store.create({ title: 'a', content: 'b' })
    const used = store.use(p.id)
    expect(used.useCount).toBe(1)
    expect(used.lastUsedAt).toBeGreaterThan(0)
    expect(used.updatedAt).toBe(p.updatedAt)
  })

  it('delete removes and returns true; second delete throws not-found', () => {
    const store = new PromptsStore(tmpPath())
    const p = store.create({ title: 'a', content: 'b' })
    expect(store.delete(p.id)).toBe(true)
    expect(() => store.delete(p.id)).toThrowError(/not-found/)
  })

  it('rejects empty title/content at create', () => {
    const store = new PromptsStore(tmpPath())
    expect(() => store.create({ title: '', content: 'b' })).toThrowError(/bad-request/)
    expect(() => store.create({ title: 'a', content: '  ' })).toThrowError(/bad-request/)
  })

  it('write fails loud on an unwritable target path', () => {
    const locked = tmpPath()
    writeFileSync(locked, '{}')
    const broken = new PromptsStore(join(locked, 'no-such-dir', 'prompts.json'))
    expect(() => broken.create({ title: 'a', content: 'b' })).toThrowError(/ENOENT|EACCES|ENOTDIR/)
  })

  it('tolerates a missing file (empty store) and fails loud on a corrupt one', () => {
    expect(new PromptsStore(tmpPath()).list()).toEqual([])
    const corrupt = tmpPath()
    writeFileSync(corrupt, '{not json')
    expect(() => new PromptsStore(corrupt)).toThrowError(/prompts\.json/)
    expect(readFileSync(corrupt, 'utf8')).toBe('{not json')
  })
})
