/**
 * Browser half of dsh-next-actions.
 *
 * - Two Conversation Definitions publish turn data. `next-actions` holds the
 *   card from this tool's `tool/result.meta` (native) or `tool/ptc-dispatch`
 *   meta (PTC `run_code`); `next-actions-sent` holds the text of the turn's
 *   first human `user/message`. `match()` reads only the current event; the
 *   turn always comes from the Engine-resolved `match.location`, because one
 *   Definition serves every session's assembler and `prepend` re-matches
 *   older pages.
 * - A `conversation.chat.turnTail` entry renders the card under every turn
 *   that produced one; clicking a suggestion fills the composer and never
 *   sends. A chip whose prompt the next user message sent as-is gets a check;
 *   one sent with edits gets a pencil. Both come from the session log. Once
 *   that message arrives the card folds to one summary row; the two states
 *   stay mounted, so a CSS grid-row transition animates folding and unfolding
 *   in both directions. Expanding or collapsing by hand lasts only for the mount.
 * - A `tool.call.toolview` entry renders the one-line process row.
 *
 * External plugins must not require Harness Client packages, so the markup and
 * CSS follow the official action card with renamed `dshna-` classes and theme
 * tokens only. DSH serves the build output as one classic script; the module
 * loader envelope lives in `scripts/build.mjs`, not here.
 *
 * The DSH-internal shapes this module reads (event payloads, the slot service,
 * the Chat snapshot slice, and the session input facade) are declared locally
 * as structural interfaces and marked "internal shape, verified against
 * 0.2.2-rc.5". Re-confirm them when DSH is upgraded.
 */

import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationContextReader,
  ConversationLocationData,
  ConversationLocationDataScope,
  ConversationMatch,
  ConversationMatchResult,
  ConversationNodeContext,
  ConversationNodeDefinitionInput,
  InputActions,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LocaleDictOf, SlotMap, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// The two slot owners bring their SlotMap declarations into the program, which
// below validates the exact keys this bundle registers into.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'

// Card and process-row CSS follow the official action card and propose_action
// row; the card's vertical offset follows built-in tail cards instead, so the
// turn tail's own gap is not doubled. Only theme tokens are referenced.
const STYLES = `
.dshna-reveal {
  display: grid;
  grid-template-rows: 1fr;
  --dshna-fold-duration: .22s;
  --dshna-fold-ease: cubic-bezier(.4, 0, .2, 1);
}
.dshna-reveal > * { min-height: 0; }
.dshna-reveal[data-fresh] { animation: dshna-reveal var(--dshna-fold-duration) var(--dshna-fold-ease) both; }
@keyframes dshna-reveal { from { grid-template-rows: 0fr; opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .dshna-reveal { --dshna-fold-duration: 0s; }
  .dshna-reveal[data-fresh] { animation: none; }
}
    /* Both states stay mounted; each row grows from 0fr to 1fr as the other shrinks.
       The item clips, not the grid: overflow on the grid itself stops 0fr collapsing. */
.dshna-reveal-clip, .dshna-summary-clip, .dshna-card-clip { min-height: 0; overflow: hidden; }
.dshna-summary-row, .dshna-card-row {
  display: grid;
  grid-template-rows: 1fr;
  transition:
    grid-template-rows var(--dshna-fold-duration) var(--dshna-fold-ease),
    opacity var(--dshna-fold-duration) var(--dshna-fold-ease),
    visibility 0s linear var(--dshna-fold-duration);
}
.dshna-summary-row { grid-template-rows: 0fr; opacity: 0; visibility: hidden; transition-delay: 0s, 0s, var(--dshna-fold-duration); pointer-events: none; }
.dshna-card-row { grid-template-rows: 1fr; opacity: 1; visibility: visible; transition-delay: 0s, 0s, 0s; pointer-events: auto; }
.dshna-reveal[data-folded] .dshna-summary-row { grid-template-rows: 1fr; opacity: 1; visibility: visible; transition-delay: 0s, 0s, 0s; pointer-events: auto; }
    /* The leaving card stays visible until its row finishes collapsing, then leaves the tab order. */
.dshna-reveal[data-folded] .dshna-card-row { grid-template-rows: 0fr; opacity: 0; visibility: hidden; transition-delay: 0s, 0s, var(--dshna-fold-duration); pointer-events: none; }
    /* The turn tail already supplies the gap above and below; the action card's
       16px margin would double both. Built-in tail cards add 4px instead. */
.dshna-card {
  overflow: hidden;
  margin: 4px 0;
  padding: 14px 20px 16px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
}
.dshna-context {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.dshna-mark { display: inline-block; vertical-align: -3px; margin-right: 6px; }
.dshna-head { display: flex; align-items: flex-start; gap: 8px; }
.dshna-head > .dshna-context { flex: 1; min-width: 0; }
.dshna-toggle {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: -2px -8px 0 0;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshna-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
    /* Collapsed card: one quiet row, like the process row, on the card's 4px offset. */
.dshna-summary {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  height: 28px;
  margin: 4px 0;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-family: var(--dsw-font-family);
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
.dshna-summary:hover { color: var(--dsw-alias-label-secondary); }
.dshna-summary > svg, .dshna-summary-title { flex: none; }
.dshna-summary > .dshna-mark { margin-right: 0; }
.dshna-summary-text { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.dshna-summary-item + .dshna-summary-item { margin-left: 10px; }
.dshna-summary-item > svg { display: inline-block; vertical-align: -1px; margin-right: 4px; }
.dshna-chips { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; margin-top: 12px; }
.dshna-chip {
  box-sizing: border-box;
  display: inline-flex;
  align-items: flex-start;
  gap: 4px;
  max-width: 100%;
  min-height: 32px;
  padding: 5.5px 12px;
  border: .5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: start;
  cursor: pointer;
}
.dshna-chip > svg { flex: none; margin-top: 4px; }
.dshna-chip:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshna-chip:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
.dshna-chip:disabled { cursor: not-allowed; opacity: .4; }
.dshna-chip:focus-visible, .dshna-toggle:focus-visible, .dshna-summary:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
    /* The whole label shows; long actions wrap instead of being cut off. */
.dshna-chip-label { min-width: 0; overflow-wrap: anywhere; }
    /* Recommended: tinted border + spark. Used (next message): check or pencil in success color; quieter label. */
.dshna-chip[data-recommended] { border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 60%, transparent); }
.dshna-spark { flex: none; color: var(--dsw-alias-state-business-primary); }
.dshna-chip[data-used] { color: var(--dsw-alias-label-secondary); }
.dshna-used { flex: none; color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 65%, var(--dsw-alias-label-primary)); }
.dshna-warn { flex: none; color: color-mix(in srgb, var(--dsw-alias-state-warn-label) 65%, var(--dsw-alias-label-primary)); }
.dshna-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: calc(24px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-tertiary);
}
.dshna-row > svg { flex: none; }
.dshna-row-title { flex: none; font-size: var(--dsh-content-font-size-secondary, 13px); }
.dshna-row-summary { min-width: 0; margin-left: 2px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`

const PKG = 'dsh-next-actions'
const NS = 'nextActions'
const TOOL_NAME = 'suggest_next_actions'
const KEY = 'next-actions'
const SENT_KEY = 'next-actions-sent'
// The card ends the turn's content. Shipped file-change, plan and action
// cards use order 0 and schedule uses 20; common third-party tail cards use
// up to 100 (visualize). Sort after all of them; the message action row follows.
const TAIL_ORDER = 1000

const EN = Object.freeze({
  'card.title': 'Suggested next actions',
  'card.collapse': 'Collapse suggested next actions',
  'chip.recommended': 'Recommended',
  'chip.danger': 'Needs confirmation',
  'chip.sent': 'Sent',
  'chip.edited': 'Sent with edits',
  'chip.aria': '{label}: {prompt}',
  'chip.ariaMarked': '{label} ({marks}): {prompt}',
  'list.separator': ', ',
  'summary.aria': '{title}: {summary}',
  'summary.used': '{label} ({mark})',
  'summary.count': '{count} unused',
  'summary.unused': '{count} unused',
  'row.title': 'Next actions',
  'row.running': 'Writing',
  'row.ok': 'Shown',
  'row.error': 'Not shown',
} as const)

/** Keys every locale table defines; also the card's translate key domain. */
type NextActionsKey = keyof typeof EN

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    nextActions: NextActionsKey
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    'next-actions': { readonly model: CardModel | null }
    'next-actions-sent': { readonly text: string }
  }
}

const ZH: LocaleDictOf<'nextActions'> = Object.freeze({
  'card.title': '下一步建议',
  'card.collapse': '收起下一步建议',
  'chip.recommended': '推荐',
  'chip.danger': '需确认',
  'chip.sent': '已发送',
  'chip.edited': '改后发送',
  'chip.aria': '{label}：{prompt}',
  'chip.ariaMarked': '{label}（{marks}）：{prompt}',
  'list.separator': '，',
  'summary.aria': '{title}：{summary}',
  'summary.used': '{label}（{mark}）',
  'summary.count': '{count} 条未使用',
  'summary.unused': '{count} 条未使用',
  'row.title': '下一步建议',
  'row.running': '正在生成',
  'row.ok': '已生成',
  'row.error': '未显示',
})
// Counts avoid a noun that agrees with the number ("2 unused", "2 sans
// suite", "2 не использовано"), so 1–3 suggestions stay grammatical in
// every locale without a plural-rules engine or a locale selector.
const JA: LocaleDictOf<'nextActions'> = Object.freeze({
  'card.title': '次のアクション候補',
  'card.collapse': '次のアクション候補を折りたたむ',
  'chip.recommended': 'おすすめ',
  'chip.danger': '確認が必要',
  'chip.sent': '送信済み',
  'chip.edited': '編集して送信',
  'chip.aria': '{label}：{prompt}',
  'chip.ariaMarked': '{label}（{marks}）：{prompt}',
  'list.separator': '、',
  'summary.aria': '{title}：{summary}',
  'summary.used': '{label}（{mark}）',
  'summary.count': '{count} 件未使用',
  'summary.unused': '{count} 件未使用',
  'row.title': '次のアクション',
  'row.running': '生成中',
  'row.ok': '表示済み',
  'row.error': '非表示',
})
const ES: LocaleDictOf<'nextActions'> = Object.freeze({
  'card.title': 'Próximos pasos sugeridos',
  'card.collapse': 'Contraer los próximos pasos sugeridos',
  'chip.recommended': 'Recomendado',
  'chip.danger': 'Requiere confirmación',
  'chip.sent': 'Enviado',
  'chip.edited': 'Enviado con cambios',
  'chip.aria': '{label}: {prompt}',
  'chip.ariaMarked': '{label} ({marks}): {prompt}',
  'list.separator': ', ',
  'summary.aria': '{title}: {summary}',
  'summary.used': '{label} ({mark})',
  'summary.count': '{count} sin usar',
  'summary.unused': '{count} sin usar',
  'row.title': 'Próximos pasos',
  'row.running': 'Generando',
  'row.ok': 'Mostrado',
  'row.error': 'No mostrado',
})
const FR: LocaleDictOf<'nextActions'> = Object.freeze({
  'card.title': 'Prochaines actions suggérées',
  'card.collapse': 'Replier les prochaines actions suggérées',
  'chip.recommended': 'Recommandée',
  'chip.danger': 'Confirmation requise',
  'chip.sent': 'Envoyée',
  'chip.edited': 'Envoyée avec modifications',
  'chip.aria': '{label} : {prompt}',
  'chip.ariaMarked': '{label} ({marks}) : {prompt}',
  'list.separator': ', ',
  'summary.aria': '{title} : {summary}',
  'summary.used': '{label} ({mark})',
  'summary.count': '{count} sans suite',
  'summary.unused': '{count} sans suite',
  'row.title': 'Prochaines actions',
  'row.running': 'Génération',
  'row.ok': 'Affiché',
  'row.error': 'Non affiché',
})
const DE: LocaleDictOf<'nextActions'> = Object.freeze({
  'card.title': 'Vorgeschlagene nächste Schritte',
  'card.collapse': 'Vorgeschlagene nächste Schritte einklappen',
  'chip.recommended': 'Empfohlen',
  'chip.danger': 'Bestätigung erforderlich',
  'chip.sent': 'Gesendet',
  'chip.edited': 'Mit Änderungen gesendet',
  'chip.aria': '{label}: {prompt}',
  'chip.ariaMarked': '{label} ({marks}): {prompt}',
  'list.separator': ', ',
  'summary.aria': '{title}: {summary}',
  'summary.used': '{label} ({mark})',
  'summary.count': '{count} ungenutzt',
  'summary.unused': '{count} ungenutzt',
  'row.title': 'Nächste Schritte',
  'row.running': 'Wird erstellt',
  'row.ok': 'Angezeigt',
  'row.error': 'Nicht angezeigt',
})
const RU: LocaleDictOf<'nextActions'> = Object.freeze({
  'card.title': 'Предлагаемые следующие действия',
  'card.collapse': 'Свернуть предлагаемые следующие действия',
  'chip.recommended': 'Рекомендуется',
  'chip.danger': 'Требует подтверждения',
  'chip.sent': 'Отправлено',
  'chip.edited': 'Отправлено с изменениями',
  'chip.aria': '{label}: {prompt}',
  'chip.ariaMarked': '{label} ({marks}): {prompt}',
  'list.separator': ', ',
  'summary.aria': '{title}: {summary}',
  'summary.used': '{label} ({mark})',
  'summary.count': '{count} не использовано',
  'summary.unused': '{count} не использовано',
  'row.title': 'Следующие действия',
  'row.running': 'Генерация',
  'row.ok': 'Показано',
  'row.error': 'Не показано',
})
const PT: LocaleDictOf<'nextActions'> = Object.freeze({
  'card.title': 'Próximas ações sugeridas',
  'card.collapse': 'Recolher as próximas ações sugeridas',
  'chip.recommended': 'Recomendada',
  'chip.danger': 'Requer confirmação',
  'chip.sent': 'Enviada',
  'chip.edited': 'Enviada com alterações',
  'chip.aria': '{label}: {prompt}',
  'chip.ariaMarked': '{label} ({marks}): {prompt}',
  'list.separator': ', ',
  'summary.aria': '{title}: {summary}',
  'summary.used': '{label} ({mark})',
  'summary.count': '{count} sem uso',
  'summary.unused': '{count} sem uso',
  'row.title': 'Próximas ações',
  'row.running': 'Gerando',
  'row.ok': 'Mostrado',
  'row.error': 'Não mostrado',
})

/** One suggestion as it reached the card model. */
interface CardSuggestion {
  readonly label: string
  readonly prompt: string
  readonly recommended?: boolean
  readonly danger?: boolean
}

/** The normalized card model, as the Host persisted it on the tool result. */
interface CardModel {
  readonly context: string
  readonly suggestions: readonly CardSuggestion[]
}

/** One card Context's State. */
interface CardState {
  readonly turn: number | null
  readonly model: CardModel | null
  readonly taken: boolean
}

/** The sent-text Context's State. */
interface SentState {
  readonly turn: number | null
  readonly text: string
  readonly taken: boolean
}

/** The turn fields a tail card and its usage check read. */
interface TurnClaim {
  readonly turn: number | null
  readonly taken?: boolean
}

/** Internal shape of one event's `data`, verified against 0.2.2-rc.5. */
type EventData = Readonly<Record<string, unknown>>

/**
 * Read one property of an untyped Client event. The DSH event union is not part
 * of the public typings, so each field this module consumes is read here and
 * narrowed at the call site.
 */
function property(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object' || !(key in source)) return undefined
  return (source as EventData)[key]
}

/** Plain text of one message content block. */
function blockText(block: unknown): string {
  if (property(block, 'type') !== 'text') return ''
  const text = property(block, 'text')
  return typeof text === 'string' ? text : ''
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(blockText).join('')
}

const isTurn = (turn: unknown): turn is number => typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 0
const isId = (value: unknown): value is string | number =>
  (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isSafeInteger(value))

/**
 * The card model is the Host-normalized `meta` on the original tool result.
 * Compaction retains the original event; replacement copies are ignored.
 * Older metas may carry up to six suggestions.
 */
function modelOf(meta: unknown): CardModel | null {
  if (property(meta, 'shown') !== true) return null
  const context = property(meta, 'context')
  if (typeof context !== 'string') return null
  const raw = property(meta, 'suggestions')
  if (!Array.isArray(raw)) return null
  const suggestions = raw
    .filter((suggestion): suggestion is CardSuggestion => {
      if (typeof suggestion !== 'object' || suggestion === null) return false
      return typeof property(suggestion, 'label') === 'string' && typeof property(suggestion, 'prompt') === 'string'
    })
    .slice(0, 3)
  return suggestions.length === 0 ? null : { context, suggestions }
}

/**
 * Turn of a Match as the Engine resolved it for this session's window. Only
 * the Engine knows which session and position an event has, so `match()`
 * never guesses a turn from earlier events.
 */
function turnOf(match: ConversationMatch): number | null {
  const location = match.location
  const placed =
    location.kind === 'turn' || location.kind === 'step' ? property(property(location, 'turn'), 'turn') : undefined
  if (isTurn(placed)) return placed
  const carried = property(property(match.event, 'data'), 'turn')
  return isTurn(carried) ? carried : null
}

/**
 * A turn's Location key has one owner. Contexts of one kind form a chain by
 * start order; `taken` says an earlier Context of the same turn already
 * owns the key. The Engine replays a Context when its predecessor changes.
 */
function takenBefore<State extends TurnClaim>(
  reader: ConversationContextReader,
  kind: string,
  turn: number,
  owns: (state: State) => boolean,
): boolean {
  const previous = reader.previous<State>(kind)?.state
  return previous !== undefined && previous.turn === turn && (previous.taken === true || owns(previous))
}

/** Match one raw Client event for the card tool. */
function matchCard(event: unknown): ConversationMatchResult | null {
  const type = property(event, 'type')
  const data = property(event, 'data')
  switch (type) {
    case 'tool/call': {
      const callId = property(data, 'callId')
      return property(data, 'name') === TOOL_NAME && isId(callId)
        ? { id: String(callId), role: 'start' }
        : null
    }
    case 'tool/result': {
      // Replacement copies of a result must not re-publish the card.
      const message = property(data, 'message')
      const callId = property(property(message, 'source'), 'callId') ?? property(message, 'toolCallId')
      return property(event, 'surfaceOp') === 'append' && isId(callId)
        ? { id: String(callId), role: 'update' }
        : null
    }
    case 'tool/ptc-dispatch-start':
    case 'tool/ptc-dispatch': {
      const rootCallId = property(data, 'rootCallId')
      return property(data, 'name') === TOOL_NAME && isId(rootCallId)
        ? {
            id: `ptc:${String(rootCallId)}`,
            role: type === 'tool/ptc-dispatch-start' ? 'start' : 'update',
          }
        : null
    }
    default:
      return null
  }
}

/** Match one raw Client event for the turn's sent text. */
function matchSent(event: unknown): ConversationMatchResult | null {
  const id = property(property(event, 'data'), 'id')
  return property(event, 'type') === 'user/message' &&
    property(event, 'surfaceOp') === 'append' &&
    property(property(property(event, 'data'), 'source'), 'kind') === 'user' &&
    isId(id)
    ? { id: String(id), role: 'start' }
    : null
}

const hasCard = (state: CardState): boolean => state.model !== null

function updateCard(context: { readonly state: CardState }, match: ConversationMatch): CardState {
  const event = match.event
  const type = property(event, 'type')
  const data = property(event, 'data')
  let model: CardModel | null = null
  if (type === 'tool/result' && property(event, 'surfaceOp') === 'append') {
    const message = property(data, 'message')
    if (message === undefined || property(message, 'isError') === true) return context.state
    model = modelOf(property(data, 'meta'))
  } else if (type === 'tool/ptc-dispatch' && property(data, 'isError') !== true) {
    model = modelOf(property(data, 'meta'))
  }
  return model === null ? context.state : { ...context.state, model }
}

/**
 * Card: one Context per call, keyed like the official tool Definition.
 * Native calls by `callId`; PTC (`run_code`) dispatches by their root call.
 * The first call of a turn that produced a card owns the turn's card.
 */
const cardDefinition: ConversationNodeDefinitionInput<CardState> = {
  kind: KEY,
  match(event) {
    return matchCard(event)
  },
  start(_context, match, reader) {
    const turn = turnOf(match)
    const state: CardState = { turn, model: null, taken: turn !== null && takenBefore(reader, KEY, turn, hasCard) }
    return updateCard({ state }, match)
  },
  update(context, match) {
    return updateCard(context, match)
  },
  buildLocationData(context, scope, previous) {
    const state = context.state
    if (scope !== 'turn' || state === undefined || state.turn === null || state.model === null || state.taken) {
      return null
    }
    if (previous?.key === KEY && previous.turn === state.turn && previous.value.model === state.model) return previous
    return { kind: 'turn', turn: state.turn, key: KEY, value: { model: state.model } }
  },
}

/**
 * Sent text: one Context per human message. The first message of a turn owns
 * the turn's `sent`, text or not: a textless reply publishes an empty value
 * so the card before it is not judged by a later message.
 */
const hasSent = (): boolean => true

const sentDefinition: ConversationNodeDefinitionInput<SentState> = {
  kind: SENT_KEY,
  match(event) {
    return matchSent(event)
  },
  start(_context, match, reader) {
    const turn = turnOf(match)
    return {
      turn,
      text: textOf(property(property(match.event, 'data'), 'content')),
      taken: turn !== null && takenBefore(reader, SENT_KEY, turn, hasSent),
    }
  },
  update(context) {
    return context.state
  },
  buildLocationData(context, scope, previous) {
    const state = context.state
    if (scope !== 'turn' || state === undefined || state.turn === null || state.taken) return null
    if (previous?.key === SENT_KEY && previous.turn === state.turn && previous.value.text === state.text) return previous
    return { kind: 'turn', turn: state.turn, key: SENT_KEY, value: { text: state.text } }
  },
}

/** One reference chip in the draft; only its clipboard width matters here. */
interface ReferenceOccurrence {
  readonly length?: number
}

/** Internal shape of the composer state the tail slot reads, verified against 0.2.2-rc.5. */
interface InputSnapshot {
  readonly draft?: string
  readonly occurrences?: readonly ReferenceOccurrence[]
}

/** Internal shape of the Chat snapshot slice the usage check reads, verified against 0.2.2-rc.5. */
interface ChatSnapshot {
  readonly timeline?: {
    readonly turnOrder?: readonly number[]
    readonly turns?: {
      get(turn: number): { readonly data?: TurnDataStore } | undefined
    }
  }
}

/** One turn's Conversation data, as the card reads it. */
interface TurnDataStore {
  get(key: string): TurnData | undefined
}

interface TurnData {
  readonly model?: CardModel | null
  readonly text?: unknown
  readonly closing?: unknown
}

/** Internal shape of the turn view a tail card receives, verified against 0.2.2-rc.5. */
interface CardTurn {
  readonly turn?: number
  readonly end?: { readonly time?: unknown }
  readonly data?: TurnDataStore
}

/** Internal shape of the session state the card reads, verified against 0.2.2-rc.5. */
interface SessionSnapshot {
  readonly subagent?: unknown
}

/** Selector hook over the composer state. */
type UseInput = <Selected>(selector: (state: InputSnapshot | undefined) => Selected) => Selected
/** Selector hook over the Chat snapshot. */
type UseChat = <Selected>(selector: (snapshot: ChatSnapshot | undefined) => Selected) => Selected
/** Selector hook over the session state. */
type UseSession = <Selected>(selector: (state: SessionSnapshot | undefined) => Selected) => Selected

/** The composer actions the card drives; a subset of the slot's InputActions. */
type DraftActions = Pick<InputActions, 'captureInsertion' | 'insertText' | 'setDraft'>

const EMPTY_OCCURRENCES: readonly ReferenceOccurrence[] = Object.freeze([])

/**
 * Characters on the CJK side of a sentence boundary: Chinese and Japanese
 * text, kana, and their punctuation. Korean keeps spaces and stays on the
 * spaced side.
 */
const CJK =
  /[\u2e80-\u303f\u3040-\u30ff\u3100-\u312f\u3190-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uff60\uff61-\uff9f\uffe0-\uffe6]/

/** Empty drafts and drafts the card wrote itself are replaced; anything else gets the action added. */
function fillMode(draft: string, owned: string | null | undefined): 'replace' | 'insert' {
  return draft.trim() === '' || draft === owned ? 'replace' : 'insert'
}

/**
 * Two sentences join without a space only when both sides of the boundary
 * are CJK. Everything else, including a CJK/Latin boundary, conservatively
 * keeps one space.
 */
function joinsWithoutSpace(left: string, right: string): boolean {
  const last = left[left.length - 1]
  const first = right[0]
  return last !== undefined && first !== undefined && CJK.test(last) && CJK.test(first)
}

/** Detect-text length: each reference chip occupies one character in the editor. */
function detectLength(draft: string, occurrences: readonly ReferenceOccurrence[]): number {
  let length = draft.length
  for (const occurrence of occurrences) {
    if (typeof occurrence.length === 'number') length -= Math.max(0, occurrence.length - 1)
  }
  return length
}

/**
 * Whether the captured selection is a caret at the very end of the draft.
 * Quotes are not part of `occurrences`, so a draft holding one conservatively
 * reads as mid-draft and keeps the default separator.
 */
function caretAtEnd(
  insertion: { readonly start: number; readonly end: number } | undefined | null,
  draft: string,
  occurrences: readonly ReferenceOccurrence[],
): boolean {
  return (
    insertion !== undefined &&
    insertion !== null &&
    insertion.start === insertion.end &&
    insertion.start === detectLength(draft, occurrences)
  )
}

/**
 * Whitespace the user appended after the card's own fill, or null. That
 * trailing whitespace is an intent signal for the next action, so only the
 * card's exact text followed by whitespace qualifies; user content and
 * @ references are never rewritten.
 */
function signalOf(owned: string | null | undefined, draft: string): string | null {
  if (typeof owned !== 'string' || owned === '' || !draft.startsWith(owned)) return null
  const tail = draft.slice(owned.length)
  return tail !== '' && /^\s+$/.test(tail) ? tail : null
}

/**
 * The draft after consuming a signal. Extra newlines mean the user wanted
 * more blank lines and are preserved; at least one blank line remains.
 * Spaces join the same paragraph, with one space unless both sides are CJK.
 */
function consumeSignal(owned: string, tail: string, prompt: string): string {
  const newlines = (tail.match(/\n/g) ?? []).length
  if (newlines > 0) return `${owned}${'\n'.repeat(Math.max(2, newlines))}${prompt}`
  return `${owned}${joinsWithoutSpace(owned, prompt) ? '' : ' '}${prompt}`
}

/**
 * What to insert before an action when the card does not own the draft: a
 * trailing newline run already starts a new line, so add only enough to
 * leave one blank line and never more. Trailing spaces are ordinary user
 * text here and stay untouched.
 */
function separatorFor(draft: string): string {
  const tail = /\s*$/.exec(draft)?.[0] ?? ''
  const newlines = (tail.match(/\n/g) ?? []).length
  if (newlines === 0) return '\n\n'
  return newlines >= 2 ? '' : '\n'
}

/** Internal shape of the conversation service reached through `ctx.get`, verified against 0.2.2-rc.5. */
interface ConversationInputLookup {
  readonly input?: { shell?(sessionId: string): { focus?(): void } | undefined }
}

/** Put the caret back in the composer after a fill; a convenience only. */
function focusComposer(ctx: Context | null, sessionId: string | undefined): void {
  if (ctx === null || sessionId === undefined) return
  const conversation = ctx.get('conversation') as unknown as ConversationInputLookup | undefined
  conversation?.input?.shell?.(sessionId)?.focus?.()
}

let sharedCtx: Context | null = null

function fill(
  actions: DraftActions,
  draft: string,
  owned: string | null,
  prompt: string,
  sessionId: string | undefined,
  occurrences: readonly ReferenceOccurrence[] = EMPTY_OCCURRENCES,
): string | null {
  let next: string | null = null
  let ownedNext: string | null = null
  if (fillMode(draft, owned) === 'insert') {
    const appended = (): string => `${draft}${separatorFor(draft)}${prompt}`
    try {
      const insertion = actions.captureInsertion()
      const atEnd = caretAtEnd(insertion, draft, occurrences)
      const signal = atEnd ? signalOf(owned, draft) : null
      if (signal !== null) {
        // The trailing whitespace is a signal: consume it into the
        // separator and rewrite the card's own text as one editor edit.
        next = consumeSignal(owned ?? '', signal, prompt)
      } else {
        // One editor edit at the caret: keeps @ references, undoable with ⌘Z.
        const separator = atEnd ? separatorFor(draft) : '\n\n'
        if (actions.insertText(`${separator}${prompt}`, insertion) !== true) {
          console.warn('[dsh-next-actions] insertText declined; appending the action instead')
          next = appended()
        }
      }
    } catch (error) {
      console.warn('[dsh-next-actions] insert at caret failed; appending the action instead', error)
      next = appended()
    }
  } else {
    next = prompt
    ownedNext = prompt
  }
  if (next !== null) actions.setDraft(next)
  try {
    focusComposer(sharedCtx, sessionId)
  } catch {
    // Focus is a convenience; the draft is already filled.
  }
  return ownedNext
}

function Mark({ size = 16 }: { readonly size?: number }): ReactElement {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 36 36',
      fill: 'none',
      className: 'dshna-mark',
      'aria-hidden': 'true',
    },
    h('rect', { x: 7, y: 17.5, width: 19, height: 5, rx: 2, fill: '#7CB7FF', fillOpacity: 0.55 }),
    h('rect', { x: 7, y: 24, width: 13, height: 5, rx: 2, fill: '#7CB7FF', fillOpacity: 0.55 }),
    h('rect', { x: 7, y: 7, width: 22, height: 8.5, rx: 2.5, fill: '#5685E2' }),
    h('path', {
      d: 'M11.75 8.85C12.08 10.37 12.63 10.92 14.15 11.25C12.63 11.58 12.08 12.13 11.75 13.65C11.42 12.13 10.87 11.58 9.35 11.25C10.87 10.92 11.42 10.37 11.75 8.85Z',
      fill: '#FFFFFF',
    }),
    h('path', {
      d: 'M16 11.25H25',
      stroke: '#FFFFFF',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
    }),
  )
}

function WarnIcon(): ReactElement {
  return h(
    'svg',
    { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', className: 'dshna-warn', 'aria-hidden': 'true' },
    h('path', {
      d: 'M8 1.8 14.6 13.2H1.4L8 1.8Z',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinejoin: 'round',
    }),
    h('path', { d: 'M8 6v3.4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
    h('circle', { cx: 8, cy: 11.4, r: 0.7, fill: 'currentColor' }),
  )
}

function SparkIcon(): ReactElement {
  return h(
    'svg',
    { width: 12, height: 12, viewBox: '0 0 16 16', className: 'dshna-spark', 'aria-hidden': 'true' },
    h('path', {
      d: 'M8 2.5C8.4 5.6 10.4 7.6 13.5 8 10.4 8.4 8.4 10.4 8 13.5 7.6 10.4 5.6 8.4 2.5 8 5.6 7.6 7.6 5.6 8 2.5Z',
      fill: 'currentColor',
    }),
  )
}

/** "Sent as-is". */
function CheckIcon(): ReactElement {
  return h(
    'svg',
    { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', className: 'dshna-used', 'aria-hidden': 'true' },
    h('path', {
      d: 'M3.5 8.5 6.5 11.5 12.5 4.5',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

/** "Sent with edits". */
function EditedIcon(): ReactElement {
  return h(
    'svg',
    { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', className: 'dshna-used', 'aria-hidden': 'true' },
    h('path', {
      d: 'M10.5 3 13 5.5 6 12.5 3 13l.5-3L10.5 3Z',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

/** Right when collapsed (expands), up when expanded (collapses). */
function ChevronIcon({ expanded }: { readonly expanded: boolean }): ReactElement {
  return h(
    'svg',
    { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
    h('path', {
      d: expanded ? 'M3.5 10 8 5.5 12.5 10' : 'M6 3.5 10.5 8 6 12.5',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

/** How the next human message used one suggestion. */
type Usage = 'full' | 'partial'

// -----------------------------------------------------------------------
// Usage: which suggestions the next human message used
//
// An inference from the sent text, not a click record: typing similar text
// by hand is marked too. Clicking fills the prompt as whole lines (the
// empty draft replaced, or "\n\n" + prompt inserted), so "sent as-is"
// means whole lines equal to the prompt.
// -----------------------------------------------------------------------

/** Prompts shorter than this (whitespace removed) only count when sent as-is. */
const EDITED_MIN_LENGTH = 4
/** Order-aware similarity (Dice over the longest common subsequence) that counts as "sent with edits". */
const EDITED_SIMILARITY = 0.6

const squash = (value: string): string => value.replace(/\s+/g, '').toLowerCase()

/** Characters of `left` kept in order in `right`. */
function commonLength(left: readonly string[], right: readonly string[]): number {
  let row = new Array<number>(right.length + 1).fill(0)
  for (const character of left) {
    const next: number[] = [0]
    for (let index = 0; index < right.length; index += 1) {
      next.push(character === right[index] ? row[index] + 1 : Math.max(row[index + 1], next[index]))
    }
    row = next
  }
  return row[right.length]
}

function similarity(target: readonly string[], text: readonly string[]): number {
  // Dice cannot reach the threshold when lengths differ too much; skip the quadratic work.
  if ((2 * Math.min(target.length, text.length)) / (target.length + text.length) < EDITED_SIMILARITY) return 0
  return (2 * commonLength(target, text)) / (target.length + text.length)
}

/**
 * 'full' when whole consecutive lines of the sent text equal the prompt;
 * 'partial' when one line or paragraph keeps most of the prompt in order.
 */
function usageOf(prompt: string, sent: string): Usage | null {
  const target = Array.from(squash(prompt))
  if (target.length === 0) return null
  const lines = sent
    .split('\n')
    .map(squash)
    .filter((line) => line !== '')
  const joined = target.join('')
  for (let first = 0; first < lines.length; first += 1) {
    let run = ''
    for (let last = first; last < lines.length && run.length < joined.length; last += 1) {
      run += lines[last]
      if (run === joined) return 'full'
    }
  }
  if (target.length < EDITED_MIN_LENGTH) return null
  const paragraphs = sent
    .split(/\n\s*\n/)
    .map(squash)
    .filter((paragraph) => paragraph !== '')
  for (const candidate of new Set([...lines, ...paragraphs])) {
    if (similarity(target, Array.from(candidate)) >= EDITED_SIMILARITY) return 'partial'
  }
  return null
}

/**
 * Text the user answered the card of `turn` with: the first message of the
 * next turn opened by a human. Turns without a human message (injected
 * context, wake-ups) are skipped, and a later turn showing its own card
 * claims the next message instead. A human turn whose message has no text
 * (an image-only reply) ends the search, so no later message is borrowed.
 * `null` while the card still awaits that reply: it is the current card.
 */
function nextSent(snapshot: ChatSnapshot | undefined, turn: number | undefined): string | null {
  const timeline = snapshot?.timeline
  const order = timeline?.turnOrder
  if (timeline === undefined || !Array.isArray(order) || turn === undefined) return null
  const index = order.indexOf(turn)
  if (index < 0) return null
  for (const later of order.slice(index + 1)) {
    const data = timeline.turns?.get(later)?.data
    const sent = data?.get(SENT_KEY)
    if (sent !== undefined) return typeof sent.text === 'string' ? sent.text : ''
    if (data?.get(KEY)?.model) return ''
  }
  return null
}

/** Only a card mounted right after its turn ends animates in; history mounts instantly. */
function isFresh(turn: CardTurn | null | undefined): boolean {
  const time = turn?.end?.time
  const value = typeof time === 'number' ? time : Date.parse(String(time))
  return Number.isFinite(value) && Date.now() - value < 5000
}

/** The summary row's copy and inline content. */
interface SummaryView {
  readonly label: string
  readonly content: ReactNode
}

/** What a folded card says: the suggestions the reply used, or how many went unused. */
function summaryOf(
  suggestions: readonly CardSuggestion[],
  usages: readonly (Usage | null)[],
  t: TranslateNS<'nextActions'>,
): SummaryView {
  const used = suggestions.flatMap((suggestion, index) =>
    usages[index] === null ? [] : [{ label: suggestion.label, usage: usages[index] }],
  )
  const count = String(suggestions.length)
  const markOf = (usage: Usage | null): string => t(usage === 'full' ? 'chip.sent' : 'chip.edited')
  const label =
    used.length > 0
      ? used.map(({ label: usedLabel, usage }) => t('summary.used', { label: usedLabel, mark: markOf(usage) })).join(t('list.separator'))
      : t('summary.unused', { count })
  return {
    label: t('summary.aria', { title: t('card.title'), summary: label }),
    content:
      used.length > 0
        ? used.map(({ label: itemLabel, usage }, index) =>
            h(
              'span',
              { key: index, className: 'dshna-summary-item' },
              h(usage === 'full' ? CheckIcon : EditedIcon),
              itemLabel,
            ),
          )
        : t('summary.count', { count }),
  }
}

/** Props the framework composes onto the tail card. */
interface NextActionsCardProps {
  readonly turn?: CardTurn | null
  readonly inputActions?: DraftActions | null
  readonly useInput?: UseInput
  readonly useChat?: UseChat
  readonly useSession?: UseSession
  readonly sessionId?: string
  readonly t: TranslateNS<'nextActions'>
}

function NextActionsCard({
  turn,
  inputActions,
  useInput,
  useChat,
  useSession,
  sessionId,
  t,
}: NextActionsCardProps): ReactElement | null {
  const ownedRef = useRef<string | null>(null)
  // Both states are mounted, so the toggle that was not clicked takes focus.
  const summaryRef = useRef<HTMLButtonElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const toggledRef = useRef(false)
  // This mount's explicit choice; `null` follows the session log.
  const [expandedChoice, setExpandedChoice] = useState<boolean | null>(null)
  const draft = useInput?.((state) => state?.draft ?? '') ?? ''
  const occurrences = useInput?.((state) => state?.occurrences ?? EMPTY_OCCURRENCES) ?? EMPTY_OCCURRENCES
  const sent = useChat?.((snapshot) => nextSent(snapshot, turn?.turn)) ?? null
  const subagent = useSession?.((state) => state?.subagent ?? null)

  const model = turn?.end === undefined ? undefined : turn.data?.get(KEY)?.model
  const closing = turn?.data?.get('turn-tail')?.closing
  const suggestions = closing && !subagent ? model?.suggestions : undefined
  const usages = useMemo(
    () => suggestions?.map(({ prompt }) => (sent === null ? null : usageOf(prompt, sent))),
    [suggestions, sent],
  )
  // A card folds once answered, at the boundary "used" is judged by.
  const awaitingReply = sent === null
  const expanded = expandedChoice ?? awaitingReply
  useEffect(() => {
    if (!toggledRef.current) return
    toggledRef.current = false
    const target = expanded ? toggleRef : summaryRef
    target.current?.focus()
  }, [expanded])
  if (!suggestions) return null

  const toggle = (): void => {
    toggledRef.current = true
    setExpandedChoice(!expanded)
  }
  const summary = summaryOf(suggestions, usages ?? [], t)
  const canWrite = typeof inputActions?.setDraft === 'function'
  const chip = (suggestion: CardSuggestion, index: number): ReactElement => {
    const usage = usages?.[index] ?? null
    const marks = [
      suggestion.recommended && t('chip.recommended'),
      suggestion.danger && t('chip.danger'),
      usage === 'full' && t('chip.sent'),
      usage === 'partial' && t('chip.edited'),
    ].filter(Boolean)
    // One leading icon: what the user did outranks what the model said.
    const icon =
      usage !== null
        ? h(usage === 'full' ? CheckIcon : EditedIcon)
        : suggestion.danger
          ? h(WarnIcon)
          : suggestion.recommended
            ? h(SparkIcon)
            : null
    return h(
      'button',
      {
        key: index,
        type: 'button',
        className: 'dshna-chip',
        'data-recommended': suggestion.recommended ? '' : undefined,
        'data-used': usage ?? undefined,
        disabled: !canWrite,
        title: suggestion.prompt,
        'aria-label':
          marks.length > 0
            ? t('chip.ariaMarked', {
                label: suggestion.label,
                marks: marks.join(t('list.separator')),
                prompt: suggestion.prompt,
              })
            : t('chip.aria', { label: suggestion.label, prompt: suggestion.prompt }),
        onClick: () => {
          if (inputActions === null || inputActions === undefined) return
          ownedRef.current = fill(inputActions, draft, ownedRef.current, suggestion.prompt, sessionId, occurrences)
        },
      },
      icon,
      h('span', { className: 'dshna-chip-label' }, suggestion.label),
    )
  }

  return h(
    'div',
    {
      className: 'dshna-reveal',
      'data-folded': expanded ? undefined : '',
      'data-fresh': isFresh(turn) ? '' : undefined,
    },
    h(
      'div',
      { className: 'dshna-reveal-clip' },
      h(
        'div',
        { className: 'dshna-summary-row' },
        h(
          'div',
          { className: 'dshna-summary-clip' },
          h(
            'button',
            {
              ref: summaryRef,
              type: 'button',
              className: 'dshna-summary',
              'aria-expanded': expanded,
              'aria-label': summary.label,
              title: model?.context,
              onClick: toggle,
            },
            h(ChevronIcon, { expanded: false }),
            h(Mark, { size: 14 }),
            h('span', { className: 'dshna-summary-title' }, t('card.title')),
            h('span', null, '·'),
            h('span', { className: 'dshna-summary-text' }, summary.content),
          ),
        ),
      ),
      h(
        'div',
        { className: 'dshna-card-row' },
        h(
          'div',
          { className: 'dshna-card-clip' },
          h(
            'section',
            { className: 'dshna-card', 'aria-label': t('card.title') },
            h(
              'div',
              { className: 'dshna-head' },
              h('p', { className: 'dshna-context' }, h(Mark), model?.context),
              // The current card has no collapse control: continuing the conversation folds it.
              awaitingReply
                ? null
                : h(
                    'button',
                    {
                      ref: toggleRef,
                      type: 'button',
                      className: 'dshna-toggle',
                      'aria-expanded': expanded,
                      'aria-label': t('card.collapse'),
                      title: t('card.collapse'),
                      onClick: toggle,
                    },
                    h(ChevronIcon, { expanded: true }),
                  ),
            ),
            h('div', { className: 'dshna-chips' }, suggestions.map(chip)),
          ),
        ),
      ),
    ),
  )
}

// -----------------------------------------------------------------------
// Process row (one line in the tool group, like the official propose_action row)
// -----------------------------------------------------------------------

/** The tool result meta the process row reads. */
interface ProcessMeta {
  readonly shown?: unknown
  readonly note?: unknown
  readonly suggestions?: unknown
}

/** Internal shape of one tool-call block, verified against 0.2.2-rc.5. */
interface ToolCallBlock {
  readonly isError?: unknown
  readonly error?: unknown
  readonly meta?: ProcessMeta
}

/** Props the framework composes onto the process row. */
interface ProcessRowProps {
  readonly phase?: string
  readonly block?: ToolCallBlock
  readonly t: TranslateNS<'nextActions'>
}

function rowState(phase: string | undefined, block: ToolCallBlock | undefined): 'running' | 'ok' | 'error' {
  if (phase === 'preparing' || phase === 'start') return 'running'
  if (block?.isError === true || block?.error !== undefined) return 'error'
  return block?.meta?.shown === false ? 'error' : 'ok'
}

function ProcessRow({ phase, block, t }: ProcessRowProps): ReactElement {
  const state = rowState(phase, block)
  const suggestions = state === 'ok' ? block?.meta?.suggestions : undefined
  const count = Array.isArray(suggestions) ? suggestions.length : 0
  const note = block?.meta?.note
  const rowKey = state === 'running' ? 'row.running' : state === 'error' ? 'row.error' : 'row.ok'
  return h(
    'div',
    { className: 'dshna-row', 'data-tool': TOOL_NAME, 'data-state': state, title: typeof note === 'string' ? note : undefined },
    h(
      'svg',
      {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1,
        'aria-hidden': 'true',
      },
      h('rect', { x: 2.25, y: 2.25, width: 4, height: 4, rx: 1 }),
      h('rect', { x: 2.25, y: 9.75, width: 4, height: 4, rx: 1 }),
      h('rect', { x: 9.75, y: 9.75, width: 4, height: 4, rx: 1 }),
      h('path', { d: 'M11.75 1.75v5M9.25 4.25h5' }),
    ),
    h('span', { className: 'dshna-row-title' }, t('row.title')),
    h('span', { className: 'dshna-row-summary' }, count > 0 ? `${t(rowKey)} · ${count}` : t(rowKey)),
  )
}

// -----------------------------------------------------------------------
// Plugin entry
// -----------------------------------------------------------------------

/** The two slot keys this bundle registers into. */
type RegisteredSlot = 'conversation.chat.turnTail' | 'tool.call.toolview'

/** A slot key the owner packages actually declare; an uninstalled owner leaves this `never`. */
type SlotName = RegisteredSlot extends keyof SlotMap ? RegisteredSlot : never

/** Registration options the framework accepts for the two slots this bundle fills. */
interface SlotRegistration {
  readonly name: SlotName
  readonly id?: string
  readonly key?: string
  readonly order?: number
  readonly locale?: string
}

/** Internal shape of the renderer's slot service, verified against 0.2.2-rc.5. */
interface SlotService {
  inject(name: SlotRegistration['name'], callback: () => () => void): void
  register(options: SlotRegistration, component: (props: never) => ReactNode): () => void
}

/** Services this Client half needs before `apply` runs. */
export const inject = ['slots', 'locale', 'uiConversation']

/**
 * Register the two Conversation Definitions, the locale tables, the stylesheet,
 * and the two slot entries. Registration and cleanup stay inside `ctx.effect`
 * or the slot lifetime.
 */
export function apply(ctx: Context): void {
  sharedCtx = ctx
  ctx.effect(
    () => ctx.locale.register(NS, { en: EN, zh: ZH, ja: JA, es: ES, fr: FR, de: DE, ru: RU, pt: PT }),
    'dsh-next-actions: locale',
  )
  ctx.effect(() => {
    const element = document.createElement('style')
    element.dataset.plugin = PKG
    element.textContent = STYLES
    document.head.appendChild(element)
    return () => element.remove()
  }, 'dsh-next-actions: styles')
  ctx.effect(() => ctx.uiConversation.events.register(cardDefinition), 'dsh-next-actions: card definition')
  ctx.effect(() => ctx.uiConversation.events.register(sentDefinition), 'dsh-next-actions: sent definition')
  const slots = (ctx as unknown as { readonly slots: SlotService }).slots
  slots.inject('conversation.chat.turnTail', () =>
    slots.register({ name: 'conversation.chat.turnTail', id: PKG, order: TAIL_ORDER, locale: NS }, NextActionsCard),
  )
  slots.inject('tool.call.toolview', () =>
    slots.register({ name: 'tool.call.toolview', key: TOOL_NAME, locale: NS }, ProcessRow),
  )
}

/** Test seams. */
export const __test = {
  cardDefinition,
  sentDefinition,
  modelOf,
  fillMode,
  fill,
  separatorFor,
  joinsWithoutSpace,
  rowState,
  usageOf,
  nextSent,
  tailOrder: TAIL_ORDER,
  styles: STYLES,
}
