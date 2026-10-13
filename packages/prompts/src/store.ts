import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Prompt } from './types.ts'

const SCHEMA_VERSION = 1

/** On-disk envelope so future format changes are detectable. */
interface PromptsFile {
  schemaVersion: number
  prompts: Prompt[]
}

export interface PromptCreateInput { title: string; content: string; note?: string; tags?: string[] }
export interface PromptPatch { title?: string; content?: string; note?: string; tags?: string[]; favorite?: boolean }

/**
 * User prompt library persisted as one JSON file under the DSH home.
 * Single-user GUI with sequential writes: no file lock (the agent-profile
 * TeamStore makes the same trade). Cache is read-disk-on-parse; every
 * mutation rewrites the file atomically (staging file + rename).
 */
export class PromptsStore {
  private cache: Prompt[] | undefined

  /** Reads eagerly: a corrupt file fails loud at construction, not at first use. */
  constructor(private readonly path: string) {
    this.cache = this.load()
  }

  list(): Prompt[] {
    return [...this.load()]
  }

  create(input: PromptCreateInput): Prompt {
    const title = requireText(input.title, 'title')
    const content = requireText(input.content, 'content')
    const now = Date.now()
    const prompt: Prompt = {
      id: randomUUID(),
      title,
      content,
      note: input.note,
      tags: [...(input.tags ?? [])],
      useCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.cache = [...this.load(), prompt]
    this.flush()
    return prompt
  }

  update(id: string, patch: PromptPatch): Prompt {
    const prompts = this.load()
    const index = prompts.findIndex(p => p.id === id)
    if (index < 0) throw new Error(`prompts: not-found ${id}`)
    const current = prompts[index]!
    const next: Prompt = { ...current }
    if (patch.title !== undefined) next.title = requireText(patch.title, 'title')
    if (patch.content !== undefined) next.content = requireText(patch.content, 'content')
    if (patch.note !== undefined) next.note = patch.note
    if (patch.tags !== undefined) next.tags = [...patch.tags]
    if (patch.favorite !== undefined) next.favorite = patch.favorite
    next.updatedAt = Date.now()
    prompts[index] = next
    this.cache = [...prompts]
    this.flush()
    return next
  }

  use(id: string): Prompt {
    const prompts = this.load()
    const index = prompts.findIndex(p => p.id === id)
    if (index < 0) throw new Error(`prompts: not-found ${id}`)
    const current = prompts[index]!
    const next: Prompt = { ...current, useCount: current.useCount + 1, lastUsedAt: Date.now() }
    prompts[index] = next
    this.cache = [...prompts]
    this.flush()
    return next
  }

  delete(id: string): boolean {
    const prompts = this.load()
    if (!prompts.some(p => p.id === id)) throw new Error(`prompts: not-found ${id}`)
    this.cache = prompts.filter(p => p.id !== id)
    this.flush()
    return true
  }

  private load(): Prompt[] {
    if (this.cache !== undefined) return this.cache
    if (!existsSync(this.path)) {
      this.cache = []
      return this.cache
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
    } catch (error) {
      throw new Error(`prompts: corrupt prompts.json at ${this.path}: ${String(error)}`)
    }
    const file = parsed as Partial<PromptsFile>
    if (!Array.isArray(file.prompts)) throw new Error(`prompts: corrupt prompts.json at ${this.path}: prompts array missing`)
    this.cache = file.prompts
    return this.cache
  }

  private flush(): void {
    const file: PromptsFile = { schemaVersion: SCHEMA_VERSION, prompts: this.cache ?? [] }
    // EEXIST races on the mkdir are fine: the staged write below is the authority.
    try { mkdirSync(dirname(this.path), { recursive: true }) } catch { /* covered by the write below */ }
    const staging = join(mkdtempSync(join(tmpdir(), 'prompts-write-')), 'prompts.json')
    writeFileSync(staging, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
    renameSync(staging, this.path)
  }
}

function requireText(value: string, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed === '') throw new Error(`prompts: bad-request ${field} is required`)
  return trimmed
}
