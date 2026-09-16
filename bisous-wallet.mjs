/** Ardoise de bisous. Pure JSON state; UI and persistence are separate. */
export const FIRST_HINT_DELAY_MS = 180_000;
export const NEXT_HINT_DELAY_MS = 120_000;
export const HINT_PRICES = Object.freeze([1, 3, 5]);
export const EQUIVALENCES = Object.freeze({ kiss: 1, lingering_kiss: 5, candlelit_dinner: 25 });
const validId = v => typeof v === 'string' && v.trim().length > 0;
const clone = v => JSON.parse(JSON.stringify(v));
const result = (ok, code, fields = {}) => ({ ok, code, ...fields });
export const remainingDebt = state => state.totalIncurred - state.totalDischarged;

export function createDebtLedger(puzzleIds) {
  if (!Array.isArray(puzzleIds) || !puzzleIds.length || !puzzleIds.every(validId) || new Set(puzzleIds).size !== puzzleIds.length) throw new TypeError('Unique puzzle IDs required');
  return { version: 2, totalIncurred: 0, totalDischarged: 0, activeIndex: 0,
    settlementOpenedAt: null, settlements: [], events: [],
    puzzles: puzzleIds.map(id => ({ id, startedAt: null, completedAt: null, nextHintAt: null, hints: [], translations: [] })) };
}

/** One event ID per interaction; replay keeps the original outcome, including refusals. */
export function applyDebtAction(snapshot, action) {
  if (!snapshot || snapshot.version !== 2 || !Array.isArray(snapshot.events)) throw new TypeError('Expected debt ledger v2; the unpublished prepaid prototype is incompatible');
  if (!action || !validId(action.eventId)) throw new TypeError('eventId required');
  const previous = snapshot.events.find(e => e.eventId === action.eventId);
  if (previous) return { state: snapshot, result: clone(previous.result), replayed: true };
  const state = clone(snapshot);
  const finish = value => { state.events.push({ eventId: action.eventId, result: value }); return { state, result: clone(value), replayed: false }; };
  const fail = code => finish(result(false, code));
  if (!Number.isSafeInteger(action.at) || action.at < 0 || action.at > Number.MAX_SAFE_INTEGER - FIRST_HINT_DELAY_MS) return fail('INVALID_TIME');
  const incur = price => {
    if (!Number.isSafeInteger(state.totalIncurred + price)) return false;
    state.totalIncurred += price; return true;
  };

  if (action.type === 'openSettlement') {
    if (state.activeIndex !== state.puzzles.length) return fail('HUNT_NOT_FINISHED');
    if (action.dinnerFinished !== true) return fail('DINNER_NOT_CONFIRMED');
    if (action.at < state.puzzles.at(-1).completedAt) return fail('INVALID_SEQUENCE');
    if (state.settlementOpenedAt === null) state.settlementOpenedAt = action.at;
    return finish(result(true, 'SETTLEMENT_OPEN', { remainingDebt: remainingDebt(state) }));
  }
  if (action.type === 'settleDebt') {
    if (state.settlementOpenedAt === null) return fail('SETTLEMENT_NOT_OPEN');
    if (action.at < state.settlementOpenedAt) return fail('INVALID_SEQUENCE');
    const rate = Object.hasOwn(EQUIVALENCES, action.kind) ? EQUIVALENCES[action.kind] : null;
    if (rate === null || !Number.isSafeInteger(action.quantity) || action.quantity < 1) return fail('INVALID_SETTLEMENT');
    const amount = rate * action.quantity;
    if (!Number.isSafeInteger(amount) || amount > remainingDebt(state)) return fail('EXCEEDS_DEBT');
    if (action.confirmed !== true) return fail('CONFIRMATION_REQUIRED');
    state.totalDischarged += amount;
    const item = { id: action.eventId, kind: action.kind, quantity: action.quantity, amount,
      at: action.at, status: action.kind === 'candlelit_dinner' ? 'promised' : 'fulfilled' };
    state.settlements.push(item);
    return finish(result(true, 'DEBT_DISCHARGED', { amount, remainingDebt: remainingDebt(state), settlement: clone(item) }));
  }
  if (action.type === 'fulfillDinnerVoucher') {
    const item = state.settlements.find(s => s.id === action.settlementId && s.kind === 'candlelit_dinner');
    if (!item) return fail('UNKNOWN_VOUCHER');
    if (action.at < item.at) return fail('INVALID_SEQUENCE');
    if (action.confirmed !== true) return fail('CONFIRMATION_REQUIRED');
    if (item.status !== 'fulfilled') { item.status = 'fulfilled'; item.fulfilledAt = action.at; }
    return finish(result(true, 'VOUCHER_FULFILLED', { amount: 0, remainingDebt: remainingDebt(state) }));
  }

  const puzzle = state.puzzles.find(p => p.id === action.puzzleId);
  if (!puzzle) return fail('UNKNOWN_PUZZLE');
  if (state.puzzles[state.activeIndex]?.id !== puzzle.id) return fail('INACTIVE_PUZZLE');
  if (action.type === 'startPuzzle') {
    if (puzzle.startedAt === null) { puzzle.startedAt = action.at; puzzle.nextHintAt = action.at + FIRST_HINT_DELAY_MS; }
    return finish(result(true, 'PUZZLE_STARTED', { nextHintAt: puzzle.nextHintAt }));
  }
  if (puzzle.startedAt === null) return fail('NOT_STARTED');
  if (action.at < puzzle.startedAt) return fail('BEFORE_START');
  if (action.type === 'completePuzzle') {
    puzzle.completedAt = action.at; state.activeIndex += 1;
    return finish(result(true, 'PUZZLE_COMPLETED', { nextPuzzleId: state.puzzles[state.activeIndex]?.id ?? null }));
  }
  if (action.type === 'buyHint') {
    const level = action.level;
    if (!Number.isInteger(level) || level < 1 || level > 3) return fail('INVALID_HINT_LEVEL');
    if (puzzle.hints.some(h => h.level === level)) return finish(result(true, 'ALREADY_OWNED', { debtAdded: 0 }));
    if (level !== puzzle.hints.length + 1) return fail('HINT_OUT_OF_ORDER');
    if (action.at < puzzle.nextHintAt) return finish(result(false, 'COOLDOWN', { availableAt: puzzle.nextHintAt }));
    const price = HINT_PRICES[level - 1];
    if (!incur(price)) return fail('DEBT_LIMIT');
    puzzle.hints.push({ level, purchasedAt: action.at, price });
    puzzle.nextHintAt = level < 3 ? action.at + NEXT_HINT_DELAY_MS : null;
    return finish(result(true, 'HINT_PURCHASED', { level, debtAdded: price, remainingDebt: remainingDebt(state), nextHintAt: puzzle.nextHintAt }));
  }
  if (action.type === 'buyTranslation') {
    if (!validId(action.translationId)) return fail('INVALID_TRANSLATION_ID');
    if (puzzle.translations.some(t => t.id === action.translationId)) return finish(result(true, 'ALREADY_OWNED', { debtAdded: 0 }));
    if (!incur(1)) return fail('DEBT_LIMIT');
    puzzle.translations.push({ id: action.translationId, purchasedAt: action.at, price: 1 });
    return finish(result(true, 'TRANSLATION_PURCHASED', { debtAdded: 1, remainingDebt: remainingDebt(state) }));
  }
  return fail('UNKNOWN_ACTION');
}

export function readHint(state, puzzleId, level) {
  return state.puzzles.find(p => p.id === puzzleId)?.hints.some(h => h.level === level)
    ? result(true, 'HINT_AVAILABLE', { debtAdded: 0 }) : result(false, 'HINT_LOCKED');
}
export function readTranslation(state, puzzleId, translationId) {
  return state.puzzles.find(p => p.id === puzzleId)?.translations.some(t => t.id === translationId)
    ? result(true, 'TRANSLATION_AVAILABLE', { debtAdded: 0 }) : result(false, 'TRANSLATION_LOCKED');
}
