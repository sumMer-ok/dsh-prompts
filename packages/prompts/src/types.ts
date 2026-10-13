/** One prompt record as persisted and wire-exposed. */
export interface Prompt {
  id: string
  title: string
  content: string
  note?: string
  tags: string[]
  favorite?: boolean
  useCount: number
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
}

/** Wire error codes for /prompts-api. */
export type PromptsApiErrorCode = 'not-found' | 'bad-request' | 'internal'
