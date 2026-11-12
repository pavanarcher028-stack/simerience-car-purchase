/* Original side-profile vehicle illustrations, drawn as SVG.
 *
 * These are not photos and not a licensed car library — they are simple vector
 * silhouettes made for this prototype. Every car renders from the same parts
 * (body, glass, wheels, lights) with per-model proportions, so the showroom has
 * consistent art with zero external requests and nothing that can 404 offline.
 */

const PAINTS = {
  crimson: { hi: "#F0786A", base: "#C0392B", low: "#6E1C14" },
  champagne: { hi: "#F6DFA9", base: "#C9A45C", low: "#6F5527" },
  graphite: { hi: "#A7B2BD", base: "#5F6B77", low: "#2A3138" },
  cobalt: { hi: "#79AFFF", base: "#2F6FD0", low: "#14305F" },
  sand: { hi: "#E3D2AC", base: "#A9905F", low: "#57462A" },
  silver: { hi: "#EEF3F8", base: "#B4BEC9", low: "#646E78" },
  forest: { hi: "#8FC5A8", base: "#3F7A5E", low: "#1B3A2C" },
};

const RULES = [
  { test: /apex|solaris|gt\b|coupe|sport/i, kind: "coupe", label: "Sport" },
  { test: /ranger|4x4|truck|off-?road/i, kind: "truck", label: "Off-road" },
  { test: /cross|suv|vanta|rover|terrain/i, kind: "suv", label: "SUV" },
  { test: /hatch|cobalt|compact/i, kind: "hatch", label: "Compact" },
  { test: /meridian|sedan|saloon|lux/i, kind: "sedan", label: "Luxury saloon" },
];

const PAINT_FOR = [
  [/apex/i, "crimson"],
  [/solaris/i, "champagne"],
  [/ranger/i, "sand"],
  [/vanta/i, "forest"],
  [/cobalt/i, "cobalt"],
  [/meridian/i, "silver"],
  [/graphite|vanta/i, "graphite"],
];

export function classify(name) {
  for (const rule of RULES) {
    if (rule.test.test(name)) return { kind: rule.kind, label: rule.label };
  }
  return { kind: "sedan", label: "Saloon" };
}

function paintFor(name) {
  for (const [test, paint] of PAINT_FOR) {
    if (test.test(name)) return PAINTS[paint];
  }
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  const keys = Object.keys(PAINTS);
  return PAINTS[keys[hash % keys.length]];
}

let counter = 0;
const uidFor = () => `v${++counter}`;

/* ------------------------------------------------------------------ parts */

function wheel(cx, cy, r) {
  const rim = r * 0.55;
  const hub = r * 0.15;
  const spokes = Array.from({ length: 5 }, (_, i) => {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    const x1 = (cx + Math.cos(a) * hub).toFixed(1);
    const y1 = (cy + Math.sin(a) * hub).toFixed(1);
    const x2 = (cx + Math.cos(a) * rim).toFixed(1);
    const y2 = (cy + Math.sin(a) * rim).toFixed(1);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join("");

  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${r + 8}" fill="#080A0C"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0C0F12"/>
    <circle cx="${cx}" cy="${cy}" r="${r - 3}" fill="none" stroke="#1A1F25" stroke-width="2.5"/>
    <circle cx="${cx}" cy="${cy}" r="${rim}" fill="#1B2128" stroke="#3A434D" stroke-width="1.4"/>
    <g stroke="#6C7680" stroke-width="2.6" stroke-linecap="round" opacity=".78">${spokes}</g>
    <circle cx="${cx}" cy="${cy}" r="${hub}" fill="#8D97A1"/>
  </g>`;
}

function glass(uid, d, pillar) {
  return `<path d="${d}" fill="url(#glass${uid})" stroke="rgba(255,255,255,.12)" stroke-width="1"/>
    <path d="${d}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1" opacity=".5"/>
    ${pillar || ""}`;
}

function bodyShape(uid, d) {
  return `<path d="${d}" fill="url(#body${uid})" stroke="rgba(0,0,0,.6)" stroke-width="1.1"/>
    <path d="${d}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.2"/>`;
}

function defs(uid, paint) {
  return `<defs>
    <linearGradient id="body${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${paint.hi}"/>
      <stop offset=".45" stop-color="${paint.base}"/>
      <stop offset="1" stop-color="${paint.low}"/>
    </linearGradient>
    <linearGradient id="glass${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22303C"/>
      <stop offset=".5" stop-color="#0B1116"/>
      <stop offset="1" stop-color="#18222B"/>
    </linearGradient>
    <radialGradient id="shadow${uid}" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#000" stop-opacity=".75"/>
      <stop offset=".65" stop-color="#000" stop-opacity=".28"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
}

/* ----------------------------------------------------------------- models */

function coupe(uid, paint) {
  const body = `M 70 240
    C 66 222 72 204 86 192
    C 102 178 126 172 152 168
    L 258 158
    C 284 154 304 148 320 136
    L 388 102
    C 402 94 420 90 440 90
    L 512 92
    C 542 94 560 102 574 116
    L 636 154
    C 664 170 688 178 702 190
    C 714 200 716 220 706 232
    C 702 238 694 240 684 240
    Z`;
  const greenhouse = `M 330 156 L 392 108 C 404 100 420 97 438 97 L 506 99
    C 532 101 548 108 560 120 L 614 152 C 596 158 566 160 530 160 L 348 160 Z`;
  const pillar = `<path d="M 462 98 L 458 160" stroke="${paint.low}" stroke-width="7"/>`;

  return `${bodyShape(uid, body)}
    ${glass(uid, greenhouse, pillar)}
    <path d="M 96 224 q 30 -5 52 0 l -2 9 q -26 3 -48 0 Z" fill="#0A0D10" opacity=".75"/>
    <path d="M 74 196 q 22 -7 46 -3 l -1 13 q -24 4 -44 -2 Z" fill="#EAF2F7" opacity=".9"/>
    <path d="M 688 196 h 18 q 4 0 4 5 v 11 q 0 5 -4 5 h -18 Z" fill="#B23A2C"/>
    <path d="M 454 166 L 458 236" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/>
    <rect x="486" y="172" width="24" height="4" rx="2" fill="${paint.low}" opacity=".85"/>
    <path d="M 352 140 q 12 -6 18 2 q 2 7 -9 7 q -9 0 -9 -9 Z" fill="${paint.low}"/>
    ${wheel(202, 248, 38)}
    ${wheel(600, 248, 38)}`;
}

function sedan(uid, paint) {
  const body = `M 72 240
    C 68 224 70 208 80 196
    C 94 182 118 176 144 172
    L 246 164
    C 272 160 292 154 308 142
    L 358 108
    C 372 98 392 94 414 94
    L 502 94
    C 528 94 546 100 560 112
    L 612 152
    L 660 162
    C 690 168 710 178 716 192
    C 720 206 716 224 706 234
    C 700 239 692 240 684 240
    Z`;
  const greenhouse = `M 316 152 L 362 112 C 374 102 392 98 412 98 L 502 98
    C 524 98 540 104 552 116 L 596 152 Z`;
  const pillar = `<path d="M 456 98 L 452 152" stroke="${paint.low}" stroke-width="6"/>`;

  return `${bodyShape(uid, body)}
    ${glass(uid, greenhouse, pillar)}
    <path d="M 98 222 q 28 -5 48 0 l -2 9 q -24 3 -44 0 Z" fill="#0A0D10" opacity=".7"/>
    <path d="M 76 198 q 24 -7 48 -3 l -1 12 q -24 4 -46 -2 Z" fill="#EAF2F7" opacity=".88"/>
    <path d="M 690 194 h 16 q 4 0 4 5 v 12 q 0 5 -4 5 h -16 Z" fill="#B23A2C"/>
    <path d="M 200 168 L 200 240" stroke="rgba(0,0,0,.22)" stroke-width="1.4"/>
    <path d="M 470 154 L 472 236" stroke="rgba(0,0,0,.3)" stroke-width="1.6"/>
    <rect x="492" y="176" width="26" height="4" rx="2" fill="${paint.low}" opacity=".85"/>
    <rect x="380" y="176" width="26" height="4" rx="2" fill="${paint.low}" opacity=".85"/>
    <path d="M 344 138 q 12 -6 18 2 q 2 7 -9 7 q -9 0 -9 -9 Z" fill="${paint.low}"/>
    ${wheel(206, 248, 40)}
    ${wheel(606, 248, 40)}`;
}

function suv(uid, paint) {
  const body = `M 70 240
    C 66 222 68 204 78 190
    C 92 176 114 170 138 166
    L 214 160
    L 252 116
    C 264 104 282 98 304 98
    L 520 98
    C 548 98 566 104 580 118
    L 620 154
    L 668 162
    C 696 168 714 178 720 194
    C 724 208 720 226 710 234
    C 704 239 696 240 688 240
    Z`;
  const greenhouse = `M 250 154 L 282 116 C 292 108 306 104 322 104 L 512 104
    C 532 104 546 110 556 122 L 592 152 Z`;

  return `${bodyShape(uid, body)}
    ${glass(uid, greenhouse, `<path d="M 408 104 L 406 152" stroke="${paint.low}" stroke-width="6"/>`)}
    <path d="M 96 220 q 30 -5 52 0 l -2 10 q -26 3 -46 0 Z" fill="#0A0D10" opacity=".72"/>
    <path d="M 74 194 q 24 -7 50 -3 l -1 13 q -26 4 -48 -2 Z" fill="#EAF2F7" opacity=".88"/>
    <path d="M 692 192 h 16 q 4 0 4 5 v 14 q 0 5 -4 5 h -16 Z" fill="#B23A2C"/>
    <rect x="208" y="182" width="8" height="26" rx="3" fill="${paint.low}" opacity=".8"/>
    <path d="M 470 158 L 474 236" stroke="rgba(0,0,0,.3)" stroke-width="1.6"/>
    <rect x="496" y="178" width="26" height="4" rx="2" fill="${paint.low}" opacity=".85"/>
    <rect x="378" y="178" width="26" height="4" rx="2" fill="${paint.low}" opacity=".85"/>
    <path d="M 336 136 q 12 -6 18 2 q 2 7 -9 7 q -9 0 -9 -9 Z" fill="${paint.low}"/>
    ${wheel(204, 248, 44)}
    ${wheel(604, 248, 44)}`;
}

function hatch(uid, paint) {
  const body = `M 74 240
    C 70 224 72 208 82 196
    C 96 182 118 176 142 172
    L 238 162
    L 288 114
    C 300 104 316 98 338 98
    L 520 100
    C 548 102 566 108 580 122
    L 618 158
    L 664 166
    C 692 172 710 182 716 196
    C 720 210 716 226 706 234
    C 700 239 692 240 684 240
    Z`;
  const greenhouse = `M 282 156 L 322 116 C 332 108 346 104 362 104 L 514 106
    C 536 108 550 114 562 126 L 596 154 Z`;

  return `${bodyShape(uid, body)}
    ${glass(uid, greenhouse, `<path d="M 452 104 L 448 156" stroke="${paint.low}" stroke-width="6"/>`)}
    <path d="M 98 220 q 28 -5 48 0 l -2 9 q -24 3 -44 0 Z" fill="#0A0D10" opacity=".7"/>
    <path d="M 76 198 q 24 -7 48 -3 l -1 12 q -24 4 -46 -2 Z" fill="#EAF2F7" opacity=".88"/>
    <path d="M 690 196 h 16 q 4 0 4 5 v 12 q 0 5 -4 5 h -16 Z" fill="#B23A2C"/>
    <path d="M 470 158 L 474 236" stroke="rgba(0,0,0,.3)" stroke-width="1.6"/>
    <rect x="492" y="178" width="24" height="4" rx="2" fill="${paint.low}" opacity=".85"/>
    <path d="M 316 138 q 12 -6 18 2 q 2 7 -9 7 q -9 0 -9 -9 Z" fill="${paint.low}"/>
    ${wheel(204, 248, 38)}
    ${wheel(602, 248, 38)}`;
}

function truck(uid, paint) {
  const cab = `M 68 236
    C 64 220 66 202 76 188
    C 90 174 112 168 136 164
    L 200 158
    L 238 114
    C 250 102 268 96 292 96
    L 404 96
    C 424 96 438 102 448 114
    L 476 154
    L 476 236
    Z`;
  const bed = `M 476 146 L 700 146 C 706 146 710 150 710 156 L 710 232
    C 710 238 706 240 700 240 L 476 240 Z`;
  const cabGlass = `M 268 152 L 300 114 C 310 106 324 102 340 102 L 400 102
    C 416 102 428 107 436 118 L 458 150 Z`;

  return `${bodyShape(uid, cab)}
    ${bodyShape(uid, bed)}
    ${glass(uid, cabGlass)}
    <path d="M 476 146 L 700 146" stroke="rgba(255,255,255,.22)" stroke-width="2"/>
    <path d="M 704 152 L 704 236" stroke="${paint.low}" stroke-width="4" opacity=".8"/>
    <path d="M 96 218 q 28 -5 48 0 l -2 10 q -24 3 -44 0 Z" fill="#0A0D10" opacity=".72"/>
    <path d="M 72 192 q 24 -7 48 -3 l -1 13 q -24 4 -46 -2 Z" fill="#EAF2F7" opacity=".88"/>
    <path d="M 696 190 h 12 q 4 0 4 5 v 16 q 0 5 -4 5 h -12 Z" fill="#B23A2C"/>
    <rect x="300" y="176" width="24" height="4" rx="2" fill="${paint.low}" opacity=".85"/>
    <path d="M 462 160 L 466 232" stroke="rgba(0,0,0,.3)" stroke-width="1.6"/>
    ${wheel(196, 244, 46)}
    ${wheel(604, 244, 46)}`;
}

const BUILDERS = { coupe, sedan, suv, hatch, truck };

/* ----------------------------------------------------------------- export */

export function carArt(name, { className = "", title = null } = {}) {
  const { kind, label } = classify(name);
  const paint = paintFor(name);
  const uid = uidFor();
  const build = BUILDERS[kind] ?? sedan;
  const shadowRx = kind === "truck" ? 336 : 312;

  return `<svg class="car-art ${className}" viewBox="0 0 800 320" role="img"
      aria-label="${title ?? `${name} — ${label} class vehicle illustration`}">
    ${defs(uid, paint)}
    <ellipse cx="400" cy="288" rx="${shadowRx}" ry="17" fill="url(#shadow${uid})"/>
    ${build(uid, paint)}
  </svg>`;
}

export function artThumb(name) {
  return carArt(name, { className: "car-art--thumb" });
}

export { PAINTS };
