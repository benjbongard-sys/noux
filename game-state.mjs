import { createDebtLedger, FIRST_HINT_DELAY_MS, NEXT_HINT_DELAY_MS, HINT_PRICES, EQUIVALENCES } from './bisous-wallet.mjs';

export function normalizeAnswer(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export function answerMatches(chapter, value) {
  if (chapter?.answer?.configured !== true || chapter.answer.type !== 'text' || !Array.isArray(chapter.answer.accepted)) return false;
  const answer = normalizeAnswer(value);
  return answer.length > 0 && chapter.answer.accepted.some(v => normalizeAnswer(v) === answer);
}
export function newGameState(game) {
  return { schemaVersion: 1, gameId: game.id, entered: false, pendingSuccess: null, notes: '',
    sortOrder: [], testOffset: 0, updatedAt: Date.now(), ledger: createDebtLedger(game.chapters.map(c => c.id)) };
}
export function validateGameState(value, game) {
  if (!value || value.schemaVersion !== 1 || value.gameId !== game.id) throw new Error('Cette sauvegarde appartient à une autre histoire.');
  const validTime = t => Number.isSafeInteger(t) && t >= 0;
  const nullableTime = t => t === null || validTime(t);
  const validId = id => typeof id === 'string' && id.trim().length > 0;
  const ledger = value.ledger;
  if (!ledger || ledger.version !== 2 || !Array.isArray(ledger.puzzles) || ledger.puzzles.length !== game.chapters.length || !Array.isArray(ledger.events) || !Array.isArray(ledger.settlements)) throw new Error('La sauvegarde est incomplète.');
  if (!Number.isInteger(ledger.activeIndex) || ledger.activeIndex < 0 || ledger.activeIndex > game.chapters.length) throw new Error('La progression est invalide.');
  if (![ledger.totalIncurred, ledger.totalDischarged].every(v => Number.isSafeInteger(v) && v >= 0) || ledger.totalDischarged > ledger.totalIncurred) throw new Error('L’ardoise est invalide.');
  if (!nullableTime(ledger.settlementOpenedAt)) throw new Error('La date d’ouverture du règlement est invalide.');
  if (ledger.events.some(e => !e || !validId(e.eventId) || !e.result || typeof e.result.ok !== 'boolean' || !validId(e.result.code)) || new Set(ledger.events.map(e => e.eventId)).size !== ledger.events.length) throw new Error('L’historique des actions est invalide.');
  let incurred = 0;
  let previousCompletedAt = null;
  for (let i = 0; i < ledger.puzzles.length; i++) {
    const p = ledger.puzzles[i];
    if (!p || p.id !== game.chapters[i].id || !Array.isArray(p.hints) || !Array.isArray(p.translations) || p.hints.length > 3) throw new Error('Les chapitres de la sauvegarde ne correspondent pas.');
    if (![p.startedAt, p.completedAt, p.nextHintAt].every(nullableTime)) throw new Error('Les délais sauvegardés sont invalides.');
    if (i < ledger.activeIndex && (p.startedAt === null || p.completedAt === null)) throw new Error('Un chapitre précédent n’est pas terminé.');
    if (i >= ledger.activeIndex && p.completedAt !== null) throw new Error('L’ordre des chapitres est invalide.');
    if (i > ledger.activeIndex && p.startedAt !== null) throw new Error('Un chapitre futur a déjà commencé.');
    if (p.startedAt === null) {
      if (p.hints.length || p.translations.length || p.nextHintAt !== null || p.completedAt !== null) throw new Error('Un chapitre fermé contient déjà des achats.');
      continue;
    }
    if (previousCompletedAt !== null && p.startedAt < previousCompletedAt) throw new Error('La chronologie des chapitres est invalide.');
    if (p.completedAt !== null && p.completedAt < p.startedAt) throw new Error('Un chapitre est terminé avant son ouverture.');
    let availableAt = p.startedAt + FIRST_HINT_DELAY_MS;
    for (let j = 0; j < p.hints.length; j++) {
      const h = p.hints[j];
      if (!h || h.level !== j + 1 || h.price !== HINT_PRICES[j] || !validTime(h.purchasedAt) || h.purchasedAt < availableAt || (p.completedAt !== null && h.purchasedAt > p.completedAt)) throw new Error('L’historique des indices est invalide.');
      incurred += h.price;
      availableAt = j === 2 ? null : h.purchasedAt + NEXT_HINT_DELAY_MS;
    }
    if (p.nextHintAt !== availableAt) throw new Error('Le prochain délai d’indice ne correspond pas à son historique.');
    if (p.translations.some(t => !t || !validId(t.id) || t.price !== 1 || !validTime(t.purchasedAt) || t.purchasedAt < p.startedAt || (p.completedAt !== null && t.purchasedAt > p.completedAt)) || new Set(p.translations.map(t => t.id)).size !== p.translations.length) throw new Error('L’historique des traductions est invalide.');
    if (p.translations.some(t => game.chapters[i].translation?.id !== t.id)) throw new Error('Cette traduction n’appartient pas au chapitre.');
    incurred += p.translations.length;
    if (p.completedAt !== null) previousCompletedAt = p.completedAt;
  }
  if (incurred !== ledger.totalIncurred) throw new Error('Le total de l’ardoise ne correspond pas aux achats.');
  if (ledger.settlementOpenedAt !== null && (ledger.activeIndex !== game.chapters.length || ledger.settlementOpenedAt < ledger.puzzles.at(-1).completedAt)) throw new Error('Le règlement précède la fin de la chasse.');
  if (ledger.settlements.length && ledger.settlementOpenedAt === null) throw new Error('Des règlements existent avant l’ouverture de l’ardoise.');
  let discharged = 0;
  const settlementIds = new Set();
  for (const s of ledger.settlements) {
    const rate = s && Object.hasOwn(EQUIVALENCES, s.kind) ? EQUIVALENCES[s.kind] : null;
    if (!rate || !validId(s.id) || settlementIds.has(s.id) || !Number.isSafeInteger(s.quantity) || s.quantity < 1 || !Number.isSafeInteger(s.amount) || s.amount !== s.quantity * rate || !validTime(s.at) || s.at < ledger.settlementOpenedAt) throw new Error('Un règlement est invalide.');
    if (s.kind === 'candlelit_dinner') {
      if (!['promised', 'fulfilled'].includes(s.status) || (s.status === 'fulfilled' && (!validTime(s.fulfilledAt) || s.fulfilledAt < s.at)) || (s.status === 'promised' && s.fulfilledAt !== undefined)) throw new Error('Le bon pour un dîner est invalide.');
    } else if (s.status !== 'fulfilled') throw new Error('Un règlement en bisous est invalide.');
    settlementIds.add(s.id);
    discharged += s.amount;
  }
  if (discharged !== ledger.totalDischarged) throw new Error('Le total réglé ne correspond pas à son historique.');
  if (value.pendingSuccess !== null && value.pendingSuccess !== game.chapters[ledger.activeIndex - 1]?.id) throw new Error('La dernière découverte est invalide.');
  if (typeof value.notes !== 'string' || value.notes.length > 20000 || !Array.isArray(value.sortOrder)) throw new Error('Le carnet est invalide.');
  const pouchIds = (game.inventory || []).filter(i => i.type === 'pouch').map(i => i.id);
  if (value.sortOrder.length && (value.sortOrder.length !== pouchIds.length || new Set(value.sortOrder).size !== value.sortOrder.length || value.sortOrder.some(id => !pouchIds.includes(id)))) throw new Error('L’ordre des pochettes est invalide.');
  if (typeof value.entered !== 'boolean' || (!value.entered && ledger.puzzles.some(p => p.startedAt !== null)) || !validTime(value.updatedAt)) throw new Error('La progression du carnet est invalide.');
  if (!Number.isSafeInteger(value.testOffset) || value.testOffset < 0 || (game.releaseMode !== 'rehearsal' && value.testOffset !== 0)) throw new Error('L’horloge de la sauvegarde est invalide.');
  return structuredClone(value);
}
