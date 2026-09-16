// Original decorative geometry. No coordinates, secrets or puzzle answers.
const point = (r, angle) => {
  const a = angle * Math.PI / 180;
  return [160 + r * Math.cos(a), 160 + r * Math.sin(a)].map(v => v.toFixed(2));
};
const ticks = Array.from({length:72}, (_, i) => {
  const [x1,y1] = point(i % 6 === 0 ? 123 : 129, i * 5);
  const [x2,y2] = point(134, i * 5);
  return `<path d="M${x1} ${y1}L${x2} ${y2}"/>`;
}).join('');

export const dialPrint = `<svg class="dial-print" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
  <g class="dial-frame"><path d="M8 26V8h18m268 0h18v18M8 294v18h18m268 0h18v-18"/><path d="M8 160h22m260 0h22M160 8v22m0 260v22"/></g>
  <g class="dial-ticks">${ticks}</g>
  <g class="dial-lines"><circle cx="160" cy="160" r="115"/><circle cx="160" cy="160" r="107" stroke-dasharray="1 5"/><ellipse cx="160" cy="160" rx="102" ry="48" transform="rotate(-35 160 160)"/><ellipse cx="160" cy="160" rx="102" ry="48" transform="rotate(35 160 160)"/></g>
  <g class="dial-accent"><path d="M160 17a143 143 0 0 1 101 42"/><path d="M59 261a143 143 0 0 1-42-101"/></g>
  <g class="dial-nodes"><circle cx="89" cy="89" r="3"/><circle cx="231" cy="231" r="3"/><path d="M268 43v12m-6-6h12M40 273v10m-5-5h10"/></g>
</svg>`;

export const cornerPrint = `<span class="print-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;

export const crossPrint = `<svg class="print-cross" viewBox="0 0 22 22" aria-hidden="true" focusable="false"><path d="M11 2v18M2 11h18"/><circle cx="11" cy="11" r="4"/></svg>`;

// Fixed visual rhythm, deliberately not a recording or an encoded clue.
const bars = Array.from({length:61}, (_, i) => {
  const x = 10 + i * 5;
  const envelope = Math.pow(Math.sin(Math.PI * i / 60), .65);
  const h = 3 + envelope * (8 + 24 * Math.abs(Math.sin(i * 1.67) * Math.cos(i * .39)));
  return `<path d="M${x} ${(42-h).toFixed(2)}v${(h*2).toFixed(2)}"/>`;
}).join('');
export const listeningPrint = `<div class="listening-print" aria-hidden="true"><div class="print-caption"><span>Face A</span><span>Une histoire à écouter</span><span>Face B</span></div><svg viewBox="0 0 320 84" focusable="false"><path class="wave-axis" d="M0 42h320M0 33v18m320-18v18"/><g class="wave-bars">${bars}</g><circle class="wave-point" cx="160" cy="42" r="3"/></svg></div>`;

export function chapterPrint(completed, total) {
  return `<div class="chapter-print"><div class="print-caption"><span>Le fil de la journée</span><span>${String(completed).padStart(2,'0')} / ${String(total).padStart(2,'0')} retrouvés</span></div><div class="progress-track" role="progressbar" aria-label="Chapitres terminés" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${completed}">${Array.from({length:total},(_,i)=>`<span class="chapter-tick${i < completed ? ' complete' : i === completed ? ' current' : ''}" aria-hidden="true"></span>`).join('')}</div></div>`;
}
