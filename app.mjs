import { dialPrint, cornerPrint, crossPrint, listeningPrint, chapterPrint } from './print-marks.mjs';
import { decryptJSON } from './crypto.mjs';
import { applyDebtAction, remainingDebt, HINT_PRICES } from './bisous-wallet.mjs';
import { answerMatches, newGameState, validateGameState } from './game-state.mjs';

const $ = s => document.querySelector(s);
const app = $('#app');
const dialog = $('#dialog');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paras = list => (list ?? []).map(t => `<p>${esc(t).replaceAll('\n', '<br>')}</p>`).join('');
const icons = {
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  arrow:'<path d="M4 12h16M13 5l7 7-7 7"/>',
  book:'<path d="M12 5c-3-2-6-2-10-1v16c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v16"/>',
  envelope:'<rect x="2" y="5" width="20" height="15" rx="1"/><path d="m2 5 10 8L22 5M2 20l7-9m13 9-7-9"/>',
  disc:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M6 12a6 6 0 0 1 6-6m0 12a6 6 0 0 0 6-6"/>',
  sparkle:'<path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  up:'<path d="m6 15 6-6 6 6"/>',
  sound:'<path d="m11 3-6 5H2v8h3l6 5Zm4 5a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  save:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? icons.sparkle}</svg>`;
const btn = (text, action, classes = '', attrs = '') => `<button class="button ${classes}" data-action="${action}" ${attrs}>${text}</button>`;
const storage = { get(key, session = false) { try { return (session ? sessionStorage : localStorage).getItem(key); } catch { return null; } }, set(key, value, session = false) { (session ? sessionStorage : localStorage).setItem(key, value); }, remove(key, session = false) { try { (session ? sessionStorage : localStorage).removeItem(key); } catch {} } };
const baseURL = new URL('./', location.href);
const embeddedPayload = $('#embedded-payload');
const namespace = `noux:${baseURL.pathname}`;
let game = null, state = null, view = 'welcome', secret = null, adminUnlocked = false, lastFocus = null, toastTimer = null, saveProblem = false, offlineReady = false, dialogBusy = false, unlocking = false;
let reducedMotion = storage.get(`${namespace}:motion`) === 'reduced';
const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const movingCards = new Set();
const motionTimers = new WeakMap();
const reduceMotion = () => reducedMotion || Boolean(motionPreference?.matches);
const canAnimate = () => !reduceMotion() && !document.hidden;
// Motion belongs to the gesture, never to the saved game or a background render.
function embellish(element, name) {
  if (!element || !canAnimate()) return;
  const timers = motionTimers.get(element) || new Map();
  motionTimers.set(element,timers);
  clearTimeout(timers.get(name));
  element.classList.add(name);
  timers.set(name,setTimeout(() => { element.classList.remove(name); timers.delete(name); },1200));
}
function animatePage(moment = 'page') { embellish($('#main'), `moment-${moment}`); }
function animateDebt() {
  document.querySelectorAll('.debt-chip,.debt-display').forEach(element => embellish(element,'moment-debt'));
}
function stopMovingCards() { for (const animation of movingCards) animation.cancel(); movingCards.clear(); }
motionPreference?.addEventListener?.('change', () => { if (reduceMotion()) stopMovingCards(); });
const stateKey = () => `${namespace}:state:${game.id}:${game.releaseMode}`;
const now = () => Date.now() + (game?.releaseMode === 'rehearsal' ? (state?.testOffset ?? 0) : 0);
const activeChapter = () => game.chapters[state.ledger.activeIndex];
const activePuzzle = () => state.ledger.puzzles[state.ledger.activeIndex];
const isComplete = id => state.ledger.puzzles.some(p => p.id === id && p.completedAt !== null);
const acquired = () => new Set(game.chapters.filter(c => isComplete(c.id)).flatMap(c => c.rewards));
const notice = message => { $('#toast').textContent = message; $('#toast').hidden = false; $('#live').textContent = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000); };
function persist() {
  state.updatedAt = Date.now();
  try { storage.set(stateKey(), JSON.stringify(state)); saveProblem = false; }
  catch { saveProblem = true; notice('Ce téléphone ne conserve pas la progression. Garde cet onglet ouvert et exporte une sauvegarde dans le menu.'); }
}
function action(type, fields = {}) {
  const outcome = applyDebtAction(state.ledger, { type, eventId: crypto.randomUUID(), at: now(), ...fields });
  state.ledger = outcome.state;
  persist();
  if (!outcome.result.ok) notice(({ COOLDOWN:'Un peu de patience : le prochain indice arrive bientôt.', INACTIVE_PUZZLE:'Cette énigme n’est pas active.', HUNT_NOT_FINISHED:'Il reste encore un chapitre à découvrir.', DINNER_NOT_CONFIRMED:'Le règlement s’ouvre après le restaurant.', EXCEEDS_DEBT:'Cette combinaison dépasse ton ardoise.', INVALID_SEQUENCE:'Vérifie l’heure du téléphone avant de continuer.' })[outcome.result.code] ?? 'Cette action n’est pas disponible pour le moment.');
  return outcome.result;
}
function setView(next, scroll = true, moment = 'page') {
  view = next; render();
  if (scroll) {
    const y = innerWidth <= 760 && next !== 'welcome'
      ? next === 'letter' ? Math.max(0,$('#main').getBoundingClientRect().top + scrollY - 24) : 73
      : 0;
    // Arrive at the page before the flourish, so it never plays off screen.
    window.scrollTo({top:y,behavior:'instant'});
  }
  if (moment) animatePage(moment);
  $('#main')?.focus({preventScroll:true});
}
function mapLink(place, text = 'Ouvrir l’itinéraire') {
  if (!place?.mapQuery && !place?.address) return '';
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.mapQuery || place.address)}`;
  return `<a class="button secondary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ${icon('arrow')}</a>`;
}
function openDialog(title, html) {
  lastFocus = document.activeElement;
  $('#dialog-content').classList.remove('moment-pouch');
  $('#dialog-content').innerHTML = `<div class="dialog-head"><span class="eyebrow">NOUX · Les heures retrouvées</span><button class="dialog-close" data-action="close-dialog" aria-label="Fermer">${icon('close')}</button></div><h2 id="dialog-title">${esc(title)}</h2>${html}`;
  dialogBusy = false;
  if (!dialog.open) dialog.showModal();
}
function closeDialog() { dialog.close(); dialogBusy = false; lastFocus?.isConnected && lastFocus.focus(); }
function confirmation(title, description, actionName, label, attrs = '') {
  openDialog(title, `<p>${esc(description)}</p><div class="button-row">${btn(esc(label),actionName,'',attrs)}${btn('Revenir','close-dialog','secondary')}</div>`);
}

function cover() {
  return `<aside class="cover" aria-label="Les heures retrouvées"><div class="cover-top micro"><span>Une histoire à deux</span><span>Face A / Face B</span></div><div><h1>Les heures<br> <em>retrouvées.</em></h1><p class="cover-copy">Il y a des détours<br>qui changent toute une vie.</p></div><div class="cover-art" aria-hidden="true"><div class="orbit">${dialPrint}<div class="orbit-core">${game ? `<span class="arabic-name" lang="ar" dir="rtl">${esc(game.nameArabic)}</span>` : icon('sparkle')}</div></div><span class="cover-art-caption">Édition à deux</span></div><div class="cover-footer"><div class="cover-footer-line"><span class="micro">${game ? 'Paris · '+new Date(game.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) : 'Une invitation personnelle'}</span><span class="mini-wave" aria-hidden="true">${'<i></i>'.repeat(16)}</span></div></div></aside>`;
}
const navItems = [['game','book','Parcours'],['inventory','envelope','Pochettes'],['wallet','heart','Ardoise'],['music','disc','Échos']];
function nav(mobile = false) {
  if (!game) return '';
  return `<nav class="${mobile ? 'mobile-nav' : 'desktop-nav'}" aria-label="${mobile ? 'Navigation mobile' : 'Navigation principale'}">${navItems.map(([id, glyph, name]) => `<button class="nav-button ${view === id ? 'active' : ''}" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${name}</span></button>`).join('')}</nav>`;
}
function render() {
  stopMovingCards();
  document.body.className = `view-${view}${reducedMotion ? ' reduce-motion' : ''}`;
  const body = !game ? lockedView() : ({welcome:welcomeView,game:gameView,inventory:inventoryView,wallet:walletView,music:musicView,settings:settingsView,regie:regieView,letter:letterView}[view] ?? welcomeView)();
  app.innerHTML = `<header class="topbar"><button class="brand-button" data-view="welcome" aria-label="Revenir à l’invitation">${crossPrint}<span class="brand-lockup"><span class="wordmark">NOUX</span><span class="brand-colophon">Les heures retrouvées</span></span></button><div class="topbar-right">${game?.releaseMode === 'rehearsal' ? '<span class="subtle-badge">Avant-première</span>' : '<span class="topbar-date">Les heures retrouvées</span>'}${game ? `<button class="debt-chip" data-view="wallet" aria-label="Ardoise : ${remainingDebt(state.ledger)} bisous dus">${icon('heart')}<b>${remainingDebt(state.ledger)}</b><span>bisous</span></button><button class="icon-button" data-view="settings" aria-label="Ouvrir le menu">${icon('settings')}</button>` : ''}</div></header><div class="layout">${cover()}<div class="main-wrap">${nav()}<main class="content" id="main" tabindex="-1">${body}</main><footer class="page-footer"><span>À garder, comme un souvenir.</span>${game ? '<button data-action="regie">Régie</button>' : '<span>Une page après l’autre.</span>'}</footer></div></div>${nav(true)}`;
  if (game) updateClock();
}
function lockedView() {
  return `<span class="eyebrow">Correspondance privée</span><h2>Cette journée<br>t’attend.</h2><p class="lead">Une enveloppe. Quelques signes.<br>Et tout ce qui reste à découvrir.</p><div class="prologue-card">${cornerPrint}<span class="to-label">À ouvrir avec ton invitation</span><h3>Le premier détour</h3><div class="seal">${icon('envelope')}</div><span class="cover-number" aria-hidden="true">01</span></div><form id="unlock-form" class="unlock-form"><label class="field-label" for="invite-key">Code de l’invitation</label><input id="invite-key" class="field-input" name="secret" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required placeholder="Le code accompagne ton invitation"><label class="check-label"><input type="checkbox" name="remember">Garder mon invitation sur ce téléphone</label><p class="error" id="unlock-error" role="alert"></p><button class="button wide" type="submit">Ouvrir mon invitation ${icon('arrow')}</button></form><p class="small-note">Si ton invitation contient un QR code, il ouvre directement cette porte.</p>`;
}
function welcomeView() {
  const started = state.entered;
  return `<span class="eyebrow">${esc(game.prologue.eyebrow)}</span><div class="section-heading"><h2>Pour toi,<br><em>${esc(game.name)}.</em></h2>${icon('sparkle')}</div><p class="lead">${esc(game.prologue.title)}</p>${paras(game.prologue.paragraphs)}<div class="prologue-card">${cornerPrint}<span class="to-label">${started ? 'Ton histoire est déjà ouverte' : 'Une invitation à prendre le temps'}</span><h3>${started ? 'Le fil de notre journée' : 'Le premier détour'}</h3><div class="seal">${icon(started ? 'book' : 'envelope')}</div><span class="cover-number" aria-hidden="true">01</span></div>${btn(`${started ? 'Reprendre mon histoire' : 'Ouvrir la première page'} ${icon('arrow')}`,'enter','wide')}${game.audio?.intro ? audioBox('intro','Un mot avant le départ') : ''}<p class="small-note">${esc(game.prologue.sealedEnvelopeText)}</p><div class="bottom-caption"><span>${esc(new Date(game.date+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long'}))} · UNE JOURNÉE POUR NOUX</span><span>13 CHAPITRES</span></div>`;
}
function gameView() {
  if (!state.entered) return welcomeView();
  if (state.pendingSuccess) return successView(game.chapters.find(c => c.id === state.pendingSuccess));
  if (!activeChapter()) return finishedView();
  const c = activeChapter(), p = activePuzzle(), started = p.startedAt !== null;
  const expectedAnswer = c.answer.configured === true;
  return `<div class="section-heading"><div><span class="eyebrow">Chapitre ${String(c.number).padStart(2,'0')} / 13 · ${esc(c.kicker)}</span><h2>${esc(c.title)}</h2></div><span class="chapter-number" aria-hidden="true">${String(c.number).padStart(2,'0')}</span></div>${chapterPrint(state.ledger.activeIndex,game.chapters.length)}<div class="chapter-meta"><span>${icon('pin')}${esc(c.place.name)}</span><span>${icon('clock')}${esc(c.time)}</span></div>${!navigator.onLine ? '<div class="offline-note">Le carnet reste ouvert hors connexion. Les itinéraires retrouveront le réseau plus tard.</div>' : ''}<p class="lead">${esc(c.intro)}</p>${!started ? `<p class="muted">Installe-toi, rassemble ce qui t’accompagne, puis ouvre cette énigme. Le temps des indices commencera à ce moment-là.</p>${btn(`Commencer ce chapitre ${icon('arrow')}`,'start','wide')}${c.place.address ? `<div class="button-row">${mapLink(c.place,'Rejoindre cette étape')}</div>` : ''}` : `${paras(c.paragraphs)}${c.id === 'c07' && game.audio?.listener ? audioBox('listener','Ferme les yeux, un instant') : ''}${c.id === 'c11' ? sortingTool() : ''}${c.translation ? translationView(c,p) : ''}<div class="prompt-card"><span class="eyebrow">À toi de jouer</span><p>${esc(c.prompt)}</p></div>${!expectedAnswer ? '<div class="draft-notice">Cette épreuve attend ses éléments de repérage. Pour cette répétition, la régie permet de poursuivre le parcours.</div>'+btn('Ouvrir la régie','regie','secondary') : c.answer.type === 'manual' ? btn(`Continuer l’histoire ${icon('arrow')}`,'manual-confirm','wide') : `<form id="answer-form" class="answer-form"><label class="field-label" for="answer">Ta réponse</label><div class="answer-control"><input class="field-input" id="answer" name="answer" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Un mot, un code, une découverte…" required><button class="button" type="submit">Valider ${icon('arrow')}</button></div><p class="error" id="answer-error" role="alert"></p></form>`}${c.id === 'c06' || c.id === 'c11' ? btn('Ouvrir la table de déchiffrement','vigenere','ghost') : ''}${hintsView(c,p)}`}`;
}
function hintsView(c,p) {
  return `<section class="hint-panel" aria-label="Indices de ce chapitre"><div class="hint-heading"><h3>Un petit coup de pouce ?</h3><span class="hint-clock">${icon('clock')}<span id="hint-clock">…</span></span></div><div class="hint-grid">${HINT_PRICES.map((price,i) => {
    const owned = p.hints.some(h => h.level === i+1), eligible = !owned && i === p.hints.length && now() >= p.nextHintAt;
    return `<button class="hint-button ${owned ? 'owned' : ''}" data-action="hint" data-level="${i+1}" ${owned || eligible ? '' : 'disabled'}><span>Indice ${i+1}</span><strong>${owned ? '✓' : '+'+price}</strong><span>${owned ? 'Relire librement' : price === 1 ? 'bisou à l’ardoise' : 'bisous à l’ardoise'}</span></button>`;
  }).join('')}</div>${p.hints.map(h => `<div class="hint-text"><span class="micro">Indice ${h.level} · déjà à toi</span>${esc(c.hints[h.level-1])}</div>`).join('')}<p class="fine-print blank-space">Les bisous s’ajoutent à ton ardoise. Tu les régleras après le dîner.</p></section>`;
}
function translationView(c,p) {
  const t = c.translation, owns = p.translations.some(x => x.id === t.id);
  return `<div class="translation"><p class="arabic-prompt" lang="ar" dir="rtl">${esc(t.arabic)}</p>${owns ? `<p>${esc(t.french)}</p><span class="fine-print">Traduction acquise · relecture offerte</span>` : btn('Un joker traduction · +1 bisou','translation','ghost')}</div>`;
}
function successView(c) {
  const items = game.inventory.filter(i => c.rewards.includes(i.id));
  return `<span class="eyebrow">Chapitre ${String(c.number).padStart(2,'0')} · retrouvé</span><div class="success-icon"><svg class="success-trace" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="37" pathLength="1"/></svg>${icon('check').replace('<path ', '<path pathLength="1" ')}</div><h2>${esc(c.success.title)}</h2><p class="lead">${esc(c.success.text)}</p>${items.map(i => `<div class="reward-row">${icon(i.type === 'pouch' ? 'envelope' : 'sparkle')}<div><span class="micro">Dans ton inventaire</span><p>${esc(i.title)}</p></div></div>`).join('')}${c.success.destination ? `<div class="destination-card"><span class="eyebrow">La prochaine porte</span><h3>${esc(c.success.destination.name)}</h3><p>${esc(c.success.destination.address)}</p>${mapLink(c.success.destination)}</div>` : ''}${c.id === 'c12' ? `<div class="button-row">${btn('Lire la lettre','show-letter','secondary')}</div>` : ''}<div class="button-row">${btn(`${c.id === 'c13' ? 'Garder ces heures' : 'Poursuivre mon histoire'} ${icon('arrow')}`,'continue','wide')}</div>`;
}
function finishedView() {
  return `<span class="eyebrow">Les treize chapitres sont à toi</span><h2>Le temps retrouvé.<br><em>Et tout le reste à vivre.</em></h2><p class="lead">Le carnet se referme. La soirée continue.</p><p>Tu peux retrouver ici tes pochettes, les mots glissés dans cette journée et l’ardoise de bisous. Son règlement s’ouvrira après le restaurant.</p>${photoView()}<div class="button-row">${btn('Relire la lettre','show-letter','secondary')}${btn('Mon ardoise','wallet-view','secondary')}</div>${timelineView()}`;
}
function timelineView() {
  return `<div class="timeline">${game.chapters.map((c,i) => `<div class="timeline-item ${i < state.ledger.activeIndex ? 'complete' : i === state.ledger.activeIndex ? 'active' : ''}"><span class="timeline-number">${i < state.ledger.activeIndex ? '✓' : String(i+1).padStart(2,'0')}</span><div><p>${i <= state.ledger.activeIndex ? esc(c.title) : 'Une page encore fermée'}</p><small>${i < state.ledger.activeIndex ? 'Retrouvé' : i === state.ledger.activeIndex ? 'À découvrir maintenant' : 'Chaque chose en son temps'}</small></div></div>`).join('')}</div>`;
}
function inventoryView() {
  const ids = acquired(), items = game.inventory.filter(i => ids.has(i.id));
  return `<span class="eyebrow">Les objets gardent la mémoire</span><div class="section-heading"><h2>Tes pochettes.<br><em>Nos petits signes.</em></h2>${icon('envelope')}</div><p>Tout ce que tu rencontres trouve sa place ici. Certains objets ont encore quelque chose à te raconter.</p>${!items.length ? `<div class="empty-state">${icon('envelope')}<p>Le carnet attend ses premiers signes.</p><small>Ils apparaîtront au fil des chapitres.</small></div>` : `<div class="inventory-grid">${items.map(i => `<button class="inventory-card ${i.type === 'pouch' && isComplete('c10') ? 'open' : ''}" data-action="inventory-item" data-id="${esc(i.id)}">${cornerPrint}${icon(i.type === 'pouch' ? 'envelope' : i.type === 'memory' ? 'heart' : 'sparkle')}${i.seal ? `<span class="roman">${esc(i.seal)}</span>` : ''}<div><h3>${esc(i.title)}</h3><p>${i.type === 'pouch' ? isComplete('c10') ? 'Prête à être ouverte' : 'Scellée pour la suite' : 'Une découverte à conserver'}</p></div></button>`).join('')}</div>`}${isComplete('c12') ? photoView()+btn('Relire la lettre','show-letter','secondary') : ''}${isComplete('c05') ? `<div class="prompt-card"><span class="eyebrow">Une place pour tes rêves</span><h3>Et toi, pour la suite ?</h3><p class="fine-print">Un souhait, une envie, quelques mots pour toi. Cette page est libre.</p><label class="sr-only" for="wish-note">Mes mots pour la suite</label><textarea id="wish-note" maxlength="10000" placeholder="J’aimerais…">${esc(state.notes)}</textarea><span class="fine-print" id="note-status">Conservé sur ce téléphone.</span></div>` : ''}`;
}
function photoView() { return game.photoDataUrl ? `<figure class="photo-card"><img src="${esc(game.photoDataUrl)}" alt="Notre photo à deux" loading="lazy"><figcaption>Nous, tout simplement.</figcaption></figure>` : ''; }
function sortingTool() {
  const pouches = game.inventory.filter(i => i.type === 'pouch' && i.memoryText && acquired().has(i.id));
  if (pouches.length !== 7) return '';
  const order = state.sortOrder.length === 7 && state.sortOrder.every(id => pouches.some(p => p.id === id)) ? state.sortOrder : pouches.map(p => p.id);
  return `<div class="pouch-sort" aria-label="Classer les sept souvenirs">${order.map((id,index) => { const p = pouches.find(i => i.id === id); return `<div class="sort-card" data-sort-id="${esc(id)}"><span class="roman">${esc(p.seal)}</span><p>${esc(p.memoryText)}</p><div class="sort-controls"><button data-action="sort-up" data-id="${esc(id)}" aria-label="Monter la pochette ${esc(p.seal)}" ${index === 0 ? 'disabled' : ''}>${icon('up')}</button><button data-action="sort-down" data-id="${esc(id)}" aria-label="Descendre la pochette ${esc(p.seal)}" ${index === 6 ? 'disabled' : ''}>${icon('down')}</button></div></div>`; }).join('')}</div><div class="assembled-letters" aria-label="Les lettres dans cet ordre">${order.map(id => esc(pouches.find(p => p.id === id).letter)).join('')}</div>`;
}
function walletView() {
  const debt = remainingDebt(state.ledger), open = state.ledger.settlementOpenedAt !== null;
  const entries = state.ledger.puzzles.flatMap(p => [...p.hints.map(h => ({name:game.chapters.find(c => c.id === p.id).title,puzzleId:p.id,level:h.level,detail:`Indice ${h.level}`,price:h.price,at:h.purchasedAt})), ...p.translations.map(t => ({name:game.chapters.find(c => c.id === p.id).title,puzzleId:p.id,translationId:t.id,detail:'Joker traduction',price:1,at:t.purchasedAt}))]).sort((a,b) => b.at-a.at);
  return `<span class="eyebrow">La plus douce des dettes</span><h2>Une ardoise<br><em>de bisous.</em></h2><p>Chaque coup de pouce laisse une petite promesse. Les bisous se règlent après le dîner, à votre façon.</p><div class="debt-display">${icon('heart')}<span class="debt-number">${debt}</span><p>${debt === 1 ? 'bisou à régler' : 'bisous à régler'}</p><div class="debt-stats"><span><strong>${state.ledger.totalIncurred}</strong>cumulés</span><span><strong>${state.ledger.totalDischarged}</strong>réglés ou convertis</span></div></div><div class="exchange-grid"><div class="exchange"><strong>1</strong><span>un bisou</span></div><div class="exchange"><strong>5</strong><span>un baiser langoureux</span></div><div class="exchange"><strong>25</strong><span>un dîner aux chandelles</span></div></div>${open ? debt > 0 ? `<form id="settle-form"><label class="field-label" for="settle-kind">Comment régler une partie de l’ardoise ?</label><select id="settle-kind" name="kind"><option value="kiss">Bisou · 1</option><option value="lingering_kiss">Baiser langoureux · 5</option><option value="candlelit_dinner">Dîner aux chandelles · 25</option></select><label class="field-label blank-space" for="settle-quantity">Combien ?</label><input class="field-input" id="settle-quantity" name="quantity" type="number" min="1" max="${debt}" value="1" required><div class="button-row"><button class="button wide" type="submit">Préparer ce règlement ${icon('heart')}</button></div></form>` : '<div class="hint-text">Ton ardoise est réglée. Les prochains bisous seront pour le plaisir.</div>' : `<p class="small-note">${activeChapter() ? 'L’ardoise reste ouverte pendant toute l’aventure. Les promesses se règlent une fois la chasse et le dîner terminés.' : 'Le parcours est terminé. À la fin du dîner, la régie pourra ouvrir le règlement.'}</p>`}${state.ledger.settlements.filter(s => s.kind === 'candlelit_dinner').map(s => `<div class="voucher"><span class="micro">Un rendez-vous pour plus tard</span><h3>${s.quantity} dîner${s.quantity > 1 ? 's' : ''} aux chandelles</h3><p>${s.status === 'fulfilled' ? 'Ce bon a été honoré.' : 'La promesse est inscrite. Il reste à choisir le soir.'}</p>${s.status !== 'fulfilled' ? btn('Ce rendez-vous a eu lieu','fulfill-voucher','secondary',`data-id="${esc(s.id)}"`) : ''}</div>`).join('')}<h3 class="blank-space">Les petits coups de pouce</h3>${entries.length ? `<div class="ledger-list">${entries.map(e => `<button class="ledger-item ledger-read" data-action="read-help" data-puzzle="${esc(e.puzzleId)}" ${e.level ? `data-level="${e.level}"` : `data-translation="${esc(e.translationId)}"`}><div><p>${esc(e.name)}</p><small>${esc(e.detail)} · Relire gratuitement</small></div><strong>+${e.price} ${e.price === 1 ? 'bisou' : 'bisous'}</strong></button>`).join('')}</div>` : '<p class="muted">Aucun indice acheté pour l’instant. L’histoire commence sans dette.</p>'}`;
}
function audioBox(id,title) { const audio = game.audio?.[id]; return audio ? `<div class="audio-box"><span class="eyebrow">Une voix pour toi</span><h3>${esc(title)}</h3><audio controls preload="metadata"><source src="${esc(audio.dataUrl)}" type="${esc(audio.mimeType)}"></audio></div>` : ''; }
function musicView() {
  return `<span class="eyebrow">Les échos de la journée</span><h2>Ce qui reste<br><em>quand on écoute.</em></h2><p>Des musiques qui nous accompagnent, des mots que l’on retrouve. Chaque voix arrive à son heure.</p>${listeningPrint}${game.audio?.intro ? audioBox('intro','Avant le premier détour') : ''}${isComplete('c06') && game.audio?.listener ? audioBox('listener','Le disque caché') : ''}<div>${game.music.map(m => `<div class="music-row"><span class="record" aria-hidden="true"></span><div><p>${esc(m.title)}</p><small>${esc(m.artist)}</small>${m.note ? `<p class="fine-print">${esc(m.note)}</p>` : ''}</div>`).join('')}</div><p class="small-note">Les titres sont un carnet d’écoute. Les morceaux complets ne sont pas intégrés au site.</p>${isComplete('c07') ? `<div class="prompt-card"><span class="eyebrow">Le message retrouvé</span><h3>${esc(game.note48?.title)}</h3>${paras(game.note48?.paragraphs)}</div>` : ''}`;
}
function letterView() {
  if (!isComplete('c12')) return gameView();
  return `<span class="eyebrow">L’enveloppe qui a voyagé avec toi</span><h2>${esc(game.letter.title)}</h2>${game.releaseMode === 'rehearsal' && game.letter.draft ? '<div class="draft-notice">Lettre proposée pour cette avant-première, à relire par Ben.</div>' : ''}<div class="letter">${paras(game.letter.paragraphs)}</div>${photoView()}${btn('Revenir à notre histoire','back-to-game','secondary')}`;
}
function settingsView() {
  return `<span class="eyebrow">Ton carnet, à ton rythme</span><h2>Les petites<br><em>choses pratiques.</em></h2><label class="toggle-line" for="motion-toggle">Réduire les animations<input id="motion-toggle" type="checkbox" ${reducedMotion ? 'checked' : ''}></label><label class="toggle-line" for="remember-toggle">Garder mon invitation sur ce téléphone<input id="remember-toggle" type="checkbox" ${storage.get(`${namespace}:invitation`) ? 'checked' : ''}></label><div class="statusline"><span class="status-dot ${navigator.onLine ? '' : 'offline'}"></span><span>${navigator.onLine ? 'Connexion disponible' : 'Hors connexion'} · ${offlineReady ? 'Carnet disponible hors connexion' : 'Chargement du carnet pour les prochaines pauses'}</span></div>${saveProblem ? '<p class="error">La sauvegarde sur ce téléphone est indisponible. Exporte ton carnet avant de fermer cet onglet.</p>' : '<p class="fine-print">La progression, les indices et l’ardoise se conservent sur ce téléphone. Garde une copie du carnet si tu veux pouvoir le restaurer.</p>'}<div class="button-row">${btn(`${icon('save')} Exporter mon carnet`,'export','secondary')}${btn('Restaurer un carnet','import','secondary')}${storage.get(`${stateKey()}:unreadable`) ? btn('Récupérer la copie illisible','export-unreadable','secondary') : ''}</div><input id="import-file" class="sr-only" type="file" accept="application/json,.json"><p class="fine-print">La copie contient ton avancée et tes notes personnelles. Elle reste à toi.</p><div class="button-row">${btn('Refermer l’invitation','lock','ghost')}</div><h3 class="blank-space">Le fil des chapitres</h3>${timelineView()}`;
}
function regieView() {
  if (!adminUnlocked) return settingsView();
  const c = activeChapter();
  return `<span class="eyebrow">Côté coulisses · pour Ben</span><h2>Tout est dans<br><em>les petits détails.</em></h2><div class="draft-notice">${game.releaseMode === 'rehearsal' ? 'Avant-première de répétition. Les repérages, le livre et les confirmations des lieux restent à finaliser.' : 'Mode jour J. Les raccourcis de régie permettent de préserver le rythme en cas d’imprévu.'}</div><div class="regie-card"><h3>Le chapitre en cours</h3><p>${c ? `${c.number}. ${esc(c.title)}` : 'Le parcours est terminé.'}</p>${c ? `<p class="fine-print">${esc(c.prompt)}</p><div class="answer-code">${c.answer.type === 'manual' ? 'Confirmation de remise / d’étape' : esc(c.answer.accepted.join(' · ') || 'Coordonnées à finaliser sur place')}</div>${paras(c.preparation.notes)}<div class="button-row">${btn('Débloquer la suite','skip-confirm','secondary')}</div>` : ''}${game.releaseMode === 'rehearsal' && c ? `<div class="button-row">${btn('Avancer les délais de 3 min','time-forward','secondary')}<span class="fine-print">Horloge de répétition uniquement</span></div>` : ''}</div><div class="regie-card"><h3>Après le restaurant</h3><p class="fine-print">Le règlement exige la fin de tous les chapitres, puis ta confirmation explicite de la fin du dîner.</p>${btn(state.ledger.settlementOpenedAt ? 'Le règlement est ouvert' : 'Confirmer la fin du dîner','dinner-confirm','secondary',activeChapter() || state.ledger.settlementOpenedAt ? 'disabled' : '')}</div><h3 class="blank-space">À préparer avant le jour J</h3>${game.preparation.map(p => `<div class="regie-card"><span class="micro">${p.status === 'ready' ? 'Prêt' : 'À préparer'}</span><h3>${esc(p.title)}</h3><p class="fine-print">${esc(p.detail)}</p></div>`).join('')}<details class="regie-card"><summary>Voir les solutions et les besoins des treize chapitres</summary>${game.chapters.map(p => `<h3>${p.number}. ${esc(p.title)}</h3><p class="fine-print">${esc(p.place.name)} · ${esc(p.time)}</p><div class="answer-code">${esc(p.answer.accepted.join(' · ') || (p.answer.type === 'manual' ? 'Étape à confirmer' : 'À finaliser'))}</div><ul>${p.preparation.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`).join('')}</details><div class="regie-controls">${btn('Exporter une sauvegarde','export','secondary')}${btn('Recommencer depuis le début','reset-confirm','danger')}${btn('Fermer la régie','close-regie','ghost')}</div>`;
}

function updateClock() {
  if (!game || !state) return;
  const p = activePuzzle();
  if (!p || p.startedAt === null) return;
  const clock = $('#hint-clock');
  if (!clock) return;
  const wait = Math.max(0, Math.ceil((p.nextHintAt - now()) / 1000));
  clock.textContent = p.hints.length === 3 ? 'Tous les indices sont à toi' : wait === 0 ? 'Le prochain indice est disponible' : `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2,'0')} avant le prochain indice`;
  for (const button of document.querySelectorAll('.hint-button')) {
    const level = Number(button.dataset.level), owns = p.hints.some(h => h.level === level);
    button.disabled = !owns && (level !== p.hints.length + 1 || wait > 0);
  }
}
function completeChapter() {
  const c = activeChapter(); if (!c) return;
  if (action('completePuzzle',{puzzleId:c.id}).ok) { state.pendingSuccess = c.id; persist(); setView('game',true,'success'); $('#live').textContent = c.success.title; }
}
// The drawing stays intact. Only its existing SVG rings turn, once the key works.
async function playInvitationUnlock() {
  const artwork = $('.cover-art');
  if (!artwork || !canAnimate()) return;
  try {
    const bounds = artwork.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > innerHeight) artwork.scrollIntoView?.({ behavior:'smooth', block:'center' });
    await new Promise(resolve => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        artwork.removeEventListener('animationend', onEnd);
        document.removeEventListener('visibilitychange', onVisibility);
        resolve();
      };
      const onEnd = event => { if (event.animationName === 'invitation-unlock-accent') finish(); };
      const onVisibility = () => { if (document.hidden) finish(); };
      artwork.addEventListener('animationend', onEnd);
      document.addEventListener('visibilitychange', onVisibility);
      artwork.classList.add('is-unlocking');
      // Also finish if CSS motion is disabled or the element is replaced.
      timer = setTimeout(finish, 3500);
    });
  } catch { /* A visual flourish must never prevent a valid invitation opening. */ }
  finally { artwork.classList.remove('is-unlocking'); }
}

function revealUnlockedName() {
  const artwork = $('.cover-art'), core = artwork?.querySelector('.orbit-core'), name = core?.querySelector('.arabic-name');
  if (!name || !canAnimate()) return;
  const star = document.createElement('span');
  star.className = 'unlock-star';
  star.setAttribute('aria-hidden','true');
  star.innerHTML = icon('sparkle');
  let timer;
  const finish = () => {
    clearTimeout(timer);
    name.removeEventListener('animationend', onEnd);
    document.removeEventListener('visibilitychange', onVisibility);
    star.remove();
    artwork.classList.remove('is-revealing');
  };
  const onEnd = event => { if (event.animationName === 'invitation-name-in') finish(); };
  const onVisibility = () => { if (document.hidden) finish(); };
  name.addEventListener('animationend',onEnd);
  document.addEventListener('visibilitychange',onVisibility);
  core.append(star);
  artwork.classList.add('is-revealing');
  // The name stays in place; only the decorative star dissolves over it.
  timer = setTimeout(finish,1200);
}

async function unlock(value, remember = false, { animate = true } = {}) {
  if (unlocking) return;
  unlocking = true;
  app.inert = true;
  app.setAttribute('aria-busy','true');
  const error = $('#unlock-error');
  if (error) error.textContent = '';
  const submit = $('#unlock-form button[type="submit"]'); if (submit) { submit.disabled = true; submit.textContent = 'L’enveloppe s’ouvre…'; }
  try {
    const key = value.trim();
    let payload;
    if (embeddedPayload) payload = JSON.parse(embeddedPayload.textContent);
    else {
      const response = await fetch(new URL('payload.json',baseURL),{cache:'no-cache'});
      if (!response.ok) throw new Error('L’invitation est momentanément inaccessible. Réessaie avec une connexion.');
      payload = await response.json();
    }
    const opened = await decryptJSON(payload,key);
    if (!opened.id || opened.chapters?.length !== 13) throw new Error('Cette invitation est incomplète.');
    game = opened; secret = key;
    let raw = storage.get(stateKey());
    try { state = raw ? validateGameState(JSON.parse(raw),game) : newGameState(game); }
    catch { state = newGameState(game); notice('Une sauvegarde ne peut pas être lue. La copie précédente est conservée dans le menu de restauration.'); if (raw) { try { storage.set(`${stateKey()}:unreadable`,raw); } catch {} } }
    try { storage.set(`${namespace}:session-invitation`,key,true); if (remember) storage.set(`${namespace}:invitation`,key); } catch { notice('Garde ton invitation pour pouvoir rouvrir le carnet.'); }
    persist();
    if (animate) await playInvitationUnlock();
    view = state.entered ? 'game' : 'welcome'; render();
    if (animate) { animatePage(); revealUnlockedName(); }
    prepareOffline();
    $('#live').textContent = 'Ton invitation est ouverte.';
  } catch (e) { game = null; secret = null; view = 'welcome'; render(); const err = $('#unlock-error'); if (err) err.textContent = e.message || 'Ce code ne permet pas d’ouvrir l’invitation.'; }
  finally {
    unlocking = false;
    app.inert = false;
    app.removeAttribute('aria-busy');
    $(game ? '#main' : '#invite-key')?.focus({ preventScroll:true });
  }
}
async function prepareOffline() {
  if (embeddedPayload) { offlineReady = true; return; }
  if (!('serviceWorker' in navigator)) return;
  try { const reg = await navigator.serviceWorker.register(new URL('sw.js',baseURL),{scope:baseURL.pathname}); await navigator.serviceWorker.ready; const worker = reg.active || reg.waiting; worker?.postMessage({type:'CACHE_INVITATION'}); } catch { /* A normal browser session remains fully usable. */ }
}

document.addEventListener('click', async event => {
  const el = event.target.closest('[data-action],[data-view]');
  if (!el || el.disabled) return;
  if (el.dataset.view) { if (game) setView(el.dataset.view); return; }
  const name = el.dataset.action;
  if (name === 'close-dialog') { closeDialog(); return; }
  if (!game) return;
  if (name === 'enter') { state.entered = true; persist(); setView('game'); }
  else if (name === 'start') { if (action('startPuzzle',{puzzleId:activeChapter().id}).ok) { render(); animatePage(); } }
  else if (name === 'continue') { state.pendingSuccess = null; persist(); setView('game'); }
  else if (name === 'back-to-game') setView('game');
  else if (name === 'wallet-view') setView('wallet');
  else if (name === 'show-letter') { if (isComplete('c12')) setView('letter',true,'letter'); }
  else if (name === 'manual-confirm') confirmation('Une page se tourne', 'Cette étape est-elle terminée ? Prends le temps de profiter de ce qui t’attend avant de continuer.', 'manual-complete', 'Oui, poursuivre');
  else if (name === 'manual-complete') { closeDialog(); completeChapter(); }
  else if (name === 'hint') {
    const c = activeChapter(), p = activePuzzle(), level = Number(el.dataset.level);
    if (p.hints.some(h => h.level === level)) openDialog(`Indice ${level}`,`<p>${esc(c.hints[level-1])}</p><p class="fine-print">Déjà acquis. Aucun bisou supplémentaire.</p>${btn('Revenir à l’énigme','close-dialog','wide')}`);
    else confirmation(`Un indice, une promesse`, `Cet indice ajoute ${HINT_PRICES[level-1]} ${HINT_PRICES[level-1] === 1 ? 'bisou' : 'bisous'} à ton ardoise. Elle passera à ${remainingDebt(state.ledger)+HINT_PRICES[level-1]} bisous à régler après le dîner.`, 'buy-hint', `Ajouter ${HINT_PRICES[level-1]} ${HINT_PRICES[level-1] === 1 ? 'bisou' : 'bisous'}`, `data-level="${level}"`);
  }
  else if (name === 'buy-hint') { if (dialogBusy) return; dialogBusy = true; el.disabled = true; const c = activeChapter(), level = Number(el.dataset.level); const outcome = action('buyHint',{puzzleId:c.id,level}); closeDialog(); if (outcome.ok) { render(); animatePage('hint'); animateDebt(); notice(`Indice ${level} ouvert · +${outcome.debtAdded} ${outcome.debtAdded === 1 ? 'bisou' : 'bisous'}`); } }
  else if (name === 'read-help') {
    const c = game.chapters.find(c => c.id === el.dataset.puzzle), p = state.ledger.puzzles.find(p => p.id === el.dataset.puzzle);
    if (!c || !p) return;
    const level = Number(el.dataset.level), ownHint = p.hints.some(h => h.level === level), ownTranslation = p.translations.some(t => t.id === el.dataset.translation);
    const content = ownHint ? c.hints[level-1] : ownTranslation ? c.translation?.french : null;
    if (content) openDialog(ownHint ? `Indice ${level}` : 'Traduction', `<p>${esc(content)}</p><p class="fine-print">Déjà acquis. Aucun bisou supplémentaire.</p>${btn('Revenir à l’ardoise','close-dialog','wide')}`);
  }
  else if (name === 'translation') confirmation('Un passage entre deux langues', 'Cette traduction ajoute 1 bisou à ton ardoise. Tu pourras ensuite la relire librement.', 'buy-translation', 'Ajouter 1 bisou');
  else if (name === 'buy-translation') { const c = activeChapter(); if (!c.translation) return; const outcome = action('buyTranslation',{puzzleId:c.id,translationId:c.translation.id}); closeDialog(); if (outcome.ok) { render(); animatePage('translation'); animateDebt(); } }
  else if (name === 'inventory-item') {
    const item = game.inventory.find(i => i.id === el.dataset.id); if (!item || !acquired().has(item.id)) return;
    const open = item.type !== 'pouch' || isComplete('c10');
    const reveal = item.type === 'pouch' && open && item.memoryText;
    const envelope = reveal ? `<div class="pouch-unseal" aria-hidden="true"><span class="pouch-paper"></span><span class="pouch-flap"></span><span class="pouch-seal">${esc(item.seal)}</span></div>` : '';
    openDialog(item.title,`${envelope}${item.type === 'pouch' && !open ? `${icon('lock')}<p>Cette pochette attend son moment. Garde-la près de toi ; un message te dira quand l’ouvrir.</p>` : `<p>${esc(item.description)}</p>${item.memoryText ? `<p class="lead">${esc(item.memoryText)}</p><span class="pouch-letter">${esc(item.letter)}</span>` : ''}`}${btn('La garder avec moi','close-dialog','wide')}`);
    if (reveal) embellish($('#dialog-content'),'moment-pouch');
  }
  else if (name === 'sort-up' || name === 'sort-down') {
    const pouches = game.inventory.filter(i => i.type === 'pouch' && i.memoryText && acquired().has(i.id));
    const order = state.sortOrder.length === 7 ? [...state.sortOrder] : pouches.map(p => p.id);
    const from = order.indexOf(el.dataset.id), to = from + (name === 'sort-up' ? -1 : 1);
    if (from < 0 || to < 0 || to >= order.length) return;
    const positions = new Map([...document.querySelectorAll('[data-sort-id]')].map(card => [card.dataset.sortId,card.getBoundingClientRect().top]));
    [order[from],order[to]] = [order[to],order[from]]; state.sortOrder = order; persist(); const scroll = scrollY; render(); window.scrollTo({top:scroll,behavior:'instant'});
    // Keep keyboard focus with the souvenir, including at either end of the list.
    const moved = [...document.querySelectorAll('[data-sort-id]')].find(card => card.dataset.sortId === el.dataset.id);
    const preferred = moved?.querySelector(`[data-action="${name}"]:not(:disabled)`);
    (preferred || moved?.querySelector('button:not(:disabled)'))?.focus({preventScroll:true});
    if (canAnimate()) {
      document.querySelectorAll('[data-sort-id]').forEach(card => {
        const before = positions.get(card.dataset.sortId), delta = before - card.getBoundingClientRect().top;
        if (!Number.isFinite(delta) || Math.abs(delta) < 1 || !card.animate) return;
        const animation = card.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:260,easing:'cubic-bezier(.2,.7,.2,1)'});
        movingCards.add(animation);
        animation.onfinish = animation.oncancel = () => movingCards.delete(animation);
      });
      embellish($('.assembled-letters'),'moment-order');
    }
  }
  else if (name === 'vigenere') {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    openDialog('Une table, une clé',`<p>Répète la clé sous ton message. Pour chaque lettre, choisis la ligne de la clé, retrouve la lettre chiffrée sur cette ligne, puis lis la lettre claire en haut de sa colonne.</p><p class="fine-print">Fais défiler la table horizontalement. Le carnet imprimé contient aussi cette table.</p><div class="table-scroll" tabindex="0" aria-label="Table de Vigenère, faire défiler"><table class="vigenere"><thead><tr><th>Clé</th>${[...letters].map(l=>`<th>${l}</th>`).join('')}</tr></thead><tbody>${[...letters].map((l,i)=>`<tr><td>${l}</td>${[...letters].map((_,j)=>`<td>${letters[(i+j)%26]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${btn('Revenir au message','close-dialog','wide')}`);
  }
  else if (name === 'regie') {
    if (adminUnlocked) { closeDialog(); setView('regie'); }
    else openDialog('Le carnet des coulisses',`<p class="fine-print">Cet espace est réservé à la préparation et aux petits imprévus du jour J.</p><form id="regie-form"><label class="field-label" for="regie-pin">Code de régie</label><input class="field-input" id="regie-pin" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" required><p id="regie-error" class="error" role="alert"></p><button class="button wide" type="submit">Ouvrir la régie</button></form>`);
  }
  else if (name === 'close-regie') { adminUnlocked = false; setView('game'); }
  else if (name === 'skip-confirm' && adminUnlocked) confirmation('Préserver le fil de l’histoire', 'Tu vas valider le chapitre en cours et remettre ses objets. Aucun bisou ne sera ajouté et les aides déjà achetées restent dans l’ardoise.', 'skip', 'Débloquer ce chapitre');
  else if (name === 'skip' && adminUnlocked) { closeDialog(); state.entered = true; if (activePuzzle().startedAt === null) action('startPuzzle',{puzzleId:activeChapter().id}); completeChapter(); }
  else if (name === 'time-forward' && adminUnlocked && game.releaseMode === 'rehearsal') { state.testOffset += 180000; persist(); render(); notice('Horloge de répétition avancée de trois minutes.'); }
  else if (name === 'dinner-confirm' && adminUnlocked) confirmation('La soirée continue', 'Confirme que le dîner est terminé pour ouvrir le règlement de l’ardoise.', 'open-settlement', 'Le dîner est terminé');
  else if (name === 'open-settlement' && adminUnlocked) { const result = action('openSettlement',{dinnerFinished:true}); closeDialog(); if (result.ok) setView('wallet'); }
  else if (name === 'settle') { if (dialogBusy) return; dialogBusy = true; el.disabled = true; const result = action('settleDebt',{kind:el.dataset.kind,quantity:Number(el.dataset.quantity),confirmed:true}); closeDialog(); if (result.ok) { render(); animateDebt(); notice('Une promesse inscrite, un peu de l’ardoise réglée.'); } }
  else if (name === 'fulfill-voucher') confirmation('Un joli rendez-vous de plus', 'Confirme que tous les dîners de ce bon ont eu lieu. Aucun bisou ne sera décompté une seconde fois.', 'fulfill-voucher-confirm', 'Ce bon a été honoré',`data-id="${esc(el.dataset.id)}"`);
  else if (name === 'fulfill-voucher-confirm') { const result = action('fulfillDinnerVoucher',{settlementId:el.dataset.id,confirmed:true}); closeDialog(); if (result.ok) render(); }
  else if (name === 'export' || name === 'export-unreadable') {
    const copy = name === 'export-unreadable' ? storage.get(`${stateKey()}:unreadable`) : JSON.stringify(state,null,2);
    if (!copy) return;
    const blob = new Blob([copy],{type:'application/json'}), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name === 'export-unreadable' ? 'NOUX-copie-a-recuperer.json' : 'NOUX-mon-carnet.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),3000); notice('La copie de ton carnet est prête à conserver.');
  }
  else if (name === 'import') $('#import-file').click();
  else if (name === 'reset-confirm' && adminUnlocked) confirmation('Recommencer le carnet', 'La progression, les notes et l’ardoise de ce téléphone seront effacées. Exporte une copie si tu veux les conserver.', 'reset', 'Recommencer à zéro');
  else if (name === 'reset' && adminUnlocked) { state = newGameState(game); persist(); closeDialog(); setView('welcome'); notice('Le carnet est revenu à sa première page.'); }
  else if (name === 'lock') { storage.remove(`${namespace}:invitation`); storage.remove(`${namespace}:session-invitation`,true); game=null; state=null; secret=null; adminUnlocked=false; view='welcome'; render(); }
});

document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target;
  if (form.id === 'unlock-form') { const fields = new FormData(form); await unlock(String(fields.get('secret')),fields.get('remember') === 'on'); }
  else if (form.id === 'answer-form') {
    const c = activeChapter(); if (!c) return;
    if (answerMatches(c,new FormData(form).get('answer'))) completeChapter();
    else { $('#answer-error').textContent = 'Pas encore. Reprends les signes : tu peux essayer autant de fois que tu veux.'; $('#live').textContent = 'La réponse ne correspond pas encore. Aucun bisou ajouté.'; }
  }
  else if (form.id === 'regie-form') {
    const pin = new FormData(form).get('pin');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(pin))))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if (digest === game.regiePinHash) { adminUnlocked = true; closeDialog(); setView('regie'); }
    else $('#regie-error').textContent = 'Ce code n’ouvre pas la régie.';
  }
  else if (form.id === 'settle-form') {
    const fields = new FormData(form), kind = String(fields.get('kind')), quantity = Number(fields.get('quantity')), rate = {kiss:1,lingering_kiss:5,candlelit_dinner:25}[kind], amount = rate*quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(amount) || amount > remainingDebt(state.ledger)) { notice('Choisis une quantité qui tient dans ton ardoise.'); return; }
    confirmation(kind === 'candlelit_dinner' ? 'Un rendez-vous à venir' : 'Une promesse tenue',kind === 'candlelit_dinner' ? `${quantity} dîner${quantity > 1 ? 's' : ''} aux chandelles : ${amount} bisous seront convertis en un bon à honorer plus tard.` : `${amount} bisous seront retirés de l’ardoise. Confirme une fois ce moment partagé.`, 'settle',kind === 'candlelit_dinner' ? 'Créer ce bon' : 'Ce moment a été partagé',`data-kind="${esc(kind)}" data-quantity="${quantity}"`);
  }
});
document.addEventListener('input',event=>{ if (event.target.id === 'wish-note' && state) { state.notes = event.target.value; persist(); $('#note-status').textContent = saveProblem ? 'Sauvegarde indisponible : garde cet onglet ouvert.' : 'Tes mots sont conservés sur ce téléphone.'; } });
document.addEventListener('change',async event=>{
  if (event.target.id === 'motion-toggle') { reducedMotion=event.target.checked; if (reducedMotion) stopMovingCards(); try { storage.set(`${namespace}:motion`,reducedMotion?'reduced':'normal'); } catch {} render(); }
  else if (event.target.id === 'remember-toggle') { try { if(event.target.checked) storage.set(`${namespace}:invitation`,secret); else storage.remove(`${namespace}:invitation`); notice(event.target.checked?'Ton invitation est conservée sur ce téléphone.':'Ton lien d’invitation permettra de rouvrir le carnet.'); } catch { event.target.checked=false; notice('Ce téléphone ne peut pas conserver ton invitation.'); } }
  else if (event.target.id === 'import-file') {
    const file=event.target.files[0];if(!file)return;
    try { if(file.size>4_000_000)throw new Error('Cette sauvegarde est trop volumineuse.'); const restored=validateGameState(JSON.parse(await file.text()),game); openDialog('Restaurer ton carnet',`<p>Cette copie contient ${restored.ledger.activeIndex} chapitres terminés et ${remainingDebt(restored.ledger)} bisous dus. Elle remplacera la progression de ce téléphone.</p><div class="button-row"><button class="button" id="restore-confirm">Restaurer cette copie</button>${btn('Revenir','close-dialog','secondary')}</div>`); $('#restore-confirm').addEventListener('click',()=>{state=restored;persist();closeDialog();setView('game');notice('Ton carnet est restauré.');},{once:true}); }
    catch(e){notice(e.message||'Ce fichier ne contient pas une sauvegarde reconnue.');}
  }
});
window.addEventListener('online',()=>{notice('La connexion est revenue.');prepareOffline();});
window.addEventListener('offline',()=>notice('Le carnet reste ouvert. Profite du chemin.'));
window.addEventListener('storage',event=>{if(game && event.key===stateKey() && event.newValue){try{const next=validateGameState(JSON.parse(event.newValue),game);if(next.updatedAt>state.updatedAt){state=next;render();}}catch{}}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')updateClock();else stopMovingCards();});
navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='CACHE_READY'){offlineReady=true;if(view==='settings')render();}});
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();}});
setInterval(updateClock,1000);

const params = new URLSearchParams(location.hash.slice(1));
const linkedInvitation = params.get('cle');
const invitation = linkedInvitation || storage.get(`${namespace}:session-invitation`,true) || storage.get(`${namespace}:invitation`);
if (params.has('cle')) history.replaceState(null,'',location.pathname+location.search);
render();
// An explicit invitation gets the opening; automatic resume stays immediate.
if(invitation) unlock(invitation,false,{animate:Boolean(linkedInvitation)});
