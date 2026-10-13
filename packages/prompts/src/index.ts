import type { Context } from '@deepseek-ai/cordis'

/**
 * Prompts plugin host half: no services of its own. Storage and the
 * /prompts-api prefix route live in ./web-api; the browser half renders all
 * UI. Prompts are pure input assistance — nothing here reaches a model
 * request or the session log.
 */
export function apply(_ctx: Context): void {}
