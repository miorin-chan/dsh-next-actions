/**
 * Host half of `dsh-next-actions`.
 *
 * Registers the `suggest_next_actions` tool for root agents plus one standing
 * prompt section that tells the model when to call it. The bundle row config
 * `enabled: false` registers nothing, so the feature costs no tokens.
 *
 * The only value import is the sibling normalizer; every DSH package is used
 * through `import type`, so the built `index.js` carries no runtime
 * `@deepseek-ai/*` dependency.
 */

import type { Context, Disposable } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { buildMeta, LIMITS, overwideLabels } from '../lib/normalize.js'
import type { CardMeta } from '../lib/normalize.js'

/** Bundle name and bundle-row id. */
export const name = 'dsh-next-actions'

/** Services this Host half needs before `apply` runs. */
export const inject = ['tools', 'systemPrompt', 'agents']

const TOOL_NAME = 'suggest_next_actions'

const GUIDANCE = [
  'Before your final answer, call suggest_next_actions once when this turn leaves real follow-up work:',
  'a task finished or advanced, tools ran, files changed, review or approval is due,',
  'or you were about to end with a list of next actions.',
  'Use it for code and engineering work too; the card sits under the reply and the reply keeps its normal plain-text format.',
  'Put those actions only in the card; the reply gets at most one lead-in sentence and never numbers or bullets them.',
  'Skip greetings, acknowledgements, pure knowledge answers, repeated cards, and turns that already asked a structured question.',
].join(' ')

const PROMPT_SECTION = 'tool:suggest-next-actions'

/** Canonical tool result; the executor awaits the body's synchronous value. */
interface ToolResultValue {
  readonly shown: boolean
  readonly count: number
}

const TOOL = {
  name: TOOL_NAME,
  description: [
    'Show 1–3 clickable next actions as a card under your reply; clicking one fills the message input, never sends.',
    'Call it once before the final answer when this turn leaves real follow-up work; if a label is returned as too wide, shorten it and call again.',
    "Write the actions in the user's language and never repeat them in your prose.",
  ].join(' '),
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['context', 'suggestions'],
    properties: {
      context: {
        type: 'string',
        description:
          'One or two sentences (≤240 chars): what was just done and why these actions follow. Never restate the answer.',
      },
      suggestions: {
        type: 'array',
        description: '1–3 distinct next actions, most useful first.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'prompt'],
          properties: {
            label: {
              type: 'string',
              description: `Short imperative button text, ≤${LIMITS.labelWidth} display columns (CJK/fullwidth count as 2), no ending punctuation; the details belong in prompt.`,
            },
            prompt: {
              type: 'string',
              description:
                "Message the user could send as-is (≤500 chars), citing this turn's files, commands or decisions.",
            },
            recommended: {
              type: 'boolean',
              description: 'At most one: your pick when one action is clearly best.',
            },
            danger: {
              type: 'boolean',
              description:
                'True only for destructive, irreversible, paid or permission-changing actions, e.g. 删除/清空/重置/发布/部署/回滚/付费/授权/卸载.',
            },
          },
        },
      },
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['shown', 'count'],
      properties: { shown: { type: 'boolean' }, count: { type: 'integer' } },
    },
    render: (_args: unknown, value: unknown): { type: 'text'; text: string }[] => {
      const shown = value !== null && typeof value === 'object' && 'shown' in value ? value.shown : undefined
      const count = value !== null && typeof value === 'object' && 'count' in value ? value.count : undefined
      return [
        {
          type: 'text',
          text:
            shown === true
              ? `Next actions shown below your answer (${String(count)}). Now write the final answer: do not list them, keep at most one lead-in sentence, and do not call this tool again this turn.`
              : 'No card shown. Answer normally; do not mention this tool.',
        },
      ]
    },
    // Persisted as tool/result.meta; the browser renders the card from it.
    presentationMeta: (args: unknown): CardMeta => buildMeta(args),
  },
  execute(args: unknown): ToolResultValue {
    const meta = buildMeta(args)
    if (!meta.shown) return { shown: false, count: 0 }
    // Review the width before the card is published. Cutting a label hides
    // what the click will do, so an overwide one goes back to the model to
    // shorten; the limit is generous enough that this stays rare.
    const overwide = overwideLabels(meta)
    if (overwide.length > 0) {
      const preview = (value: string): string => {
        const characters = Array.from(value)
        return characters.length > 36 ? `${characters.slice(0, 35).join('')}…` : value
      }
      const labels = overwide
        .map(({ position, label, width }) => `#${position} "${preview(label)}" is ${width} columns`)
        .join('; ')
      throw new Error(
        `${overwide.length === 1 ? 'label' : 'labels'} too wide (limit ${LIMITS.labelWidth} columns): ${labels}. The card was not shown; shorten the label(s) to a few words, move the details into prompt, and call ${TOOL_NAME} again.`,
      )
    }
    return { shown: true, count: meta.suggestions.length }
  },
}

/**
 * The tool definition as this module builds it. The Host executor awaits the
 * returned value, so the body stays synchronous and the registered contract
 * type is asserted at that one boundary.
 */
type LocalToolDefinition = typeof TOOL

/** Only a literal `enabled: false` turns the feature off. */
export function normalizeConfig(raw: unknown): { readonly enabled: boolean } {
  const disabled = raw !== null && typeof raw === 'object' && 'enabled' in raw && raw.enabled === false
  return { enabled: !disabled }
}

/**
 * Ordinary session agents only. Delegated agents carry the durable
 * `origin: 'subagent'` header; `AgentRegistry.roots()` no longer exists since
 * DSH 0.2.1-rc.3, so the header is the supported discriminator. Fail open so a
 * Harness change never silently hides the tool, and report the drift once.
 */
function isRoot(agent: unknown, onUnreadable?: (error: unknown) => void): boolean {
  if (agent === null || agent === undefined) return true
  try {
    if (typeof agent !== 'object' || !('session' in agent)) throw new TypeError('the agent has no session')
    const session = agent.session
    if (session === null || typeof session !== 'object' || !('header' in session)) {
      throw new TypeError('the session has no header')
    }
    const header = session.header
    if (header === null || typeof header !== 'object') {
      throw new TypeError('the session header is unreadable')
    }
    return ('origin' in header ? header.origin : undefined) !== 'subagent'
  } catch (error) {
    onUnreadable?.(error)
    return true
  }
}

/**
 * Register the tool and its standing guidance section, gated to root agents.
 * Registration and cleanup stay inside `ctx.effect`.
 */
export function apply(ctx: Context, config?: unknown): void {
  if (!normalizeConfig(config).enabled) return

  /** Host log, with a console fallback so a missing logger cannot hide the report. */
  const warn = (message: string): void => {
    const line = `dsh-next-actions: ${message}`
    try {
      if (typeof ctx.logger?.warn === 'function') {
        ctx.logger.warn(line)
        return
      }
    } catch {
      // Fall through: the warning must not depend on a working logger.
    }
    console.warn(line)
  }

  /** Report a header-shape change once; `when` runs on every tool resolution. */
  let headerFailureReported = false
  const isRootAgent = (agent: unknown): boolean =>
    isRoot(agent, (error) => {
      if (headerFailureReported) return
      headerFailureReported = true
      warn(`agent session header unreadable; treating the agent as a root: ${String(error)}`)
    })

  // The executor awaits `execute`'s return value; the declared contract types
  // it as a Promise, which the synchronous body intentionally does not return.
  const definition = TOOL as unknown as ToolDefinition
  ctx.effect(
    () => ctx.tools.register(definition, { when: ({ agent }) => isRootAgent(agent) }),
    'dsh-next-actions: tool',
  )

  /** agent → disposer of its prompt section. */
  const installed = new Map<Agent, Disposable<Promise<void>>>()
  const install = (agent: Agent): void => {
    if (installed.has(agent) || !isRootAgent(agent)) return
    try {
      const prompt = agent.ctx.systemPrompt
      const base = prompt.getSectionOrder?.('TOOL_REPORT')
      installed.set(
        agent,
        agent.ctx.effect(
          () =>
            prompt.section({
              name: PROMPT_SECTION,
              order: typeof base === 'number' ? base + 50 : 2950,
              text: GUIDANCE,
            }),
          'dsh-next-actions: guidance',
        ),
      )
    } catch (error) {
      // The tool still works without the guidance; surface the degradation
      // instead of silently losing the standing instruction.
      warn(`guidance not installed: ${String(error)}`)
    }
  }

  ctx.effect(() => {
    const offCreated = ctx.on('agent/created', ({ agent }) => {
      install(agent)
      return undefined
    })
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
      installed.delete(agent)
    })
    try {
      for (const agent of ctx.agents.list()) install(agent)
    } catch (error) {
      // Agents created later still arrive through agent/created, but agents
      // that were already live at apply time keep missing the guidance.
      warn(`could not install guidance on existing agents: ${String(error)}`)
    }
    return () => {
      offCreated()
      offDisposed()
      for (const dispose of installed.values()) {
        try {
          dispose()
        } catch {
          // The agent may already be gone.
        }
      }
      installed.clear()
    }
  }, 'dsh-next-actions: guidance')
}

/** Test seams. */
export const __definition: LocalToolDefinition = TOOL
export const __guidance = { section: PROMPT_SECTION, text: GUIDANCE }
