/* SIMERIENCE · Motorworks — concurrency lab
 *
 * Fires two genuine POST /purchase requests for the same single-stock car in
 * the same tick, prints the raw outcomes, then re-reads the database to verify
 * that exactly one transaction committed. No simulated results anywhere.
 */

import { api, coins, el } from "./api.js";
import { carArt, classify } from "./art.js";

const els = {
  prizeArt: document.getElementById("prize-art"),
  prizeName: document.getElementById("prize-name"),
  prizeClass: document.getElementById("prize-class"),
  prizeStock: document.getElementById("prize-stock"),
  prizePrice: document.getElementById("prize-price"),
  prizeCount: document.getElementById("prize-count"),
  racer0: document.getElementById("racer-0"),
  racer1: document.getElementById("racer-1"),
  start: document.getElementById("race-start"),
  status: document.getElementById("race-status"),
  resultsSection: document.getElementById("results-section"),
  resultCards: document.getElementById("result-cards"),
  elapsed: document.getElementById("race-elapsed"),
  verdict: document.getElementById("verdict"),
  verdictTitle: document.getElementById("verdict-title"),
  verdictChecks: document.getElementById("verdict-checks"),
  verdictNote: document.getElementById("verdict-note"),
  devReset: document.getElementById("dev-reset"),
  toasts: document.getElementById("toasts"),
};

const state = {
  players: [],
  cars: [],
  car: null,
  running: false,
  completed: false,
  outcomes: {},
  before: {},
  winnerId: null,
};

/* ---------------------------------------------------------------- helpers */

function toast(message, kind = "") {
  const node = el("div", `toast${kind ? " toast--" + kind : ""}`, message);
  node.setAttribute("role", "status");
  els.toasts.append(node);
  setTimeout(() => node.remove(), 5000);
}

const isNetworkError = (result) => result.status === 0;

function setStatus(text) {
  els.status.textContent = text;
}

function pickCar() {
  const [a, b] = state.players;
  if (!a || !b) return null;
  const spendable = Math.min(a.balance, b.balance);
  return state.cars.find((car) => car.stock === 1 && car.price <= spendable) ?? null;
}

async function getJson(path) {
  const result = await api("GET", path);
  return result.ok ? result.data : null;
}

/* ----------------------------------------------------------------- render */

function renderPrize() {
  const car = state.car;

  if (!car) {
    els.prizeArt.replaceChildren();
    els.prizeName.textContent = "Nothing left to race";
    els.prizeClass.textContent = "—";
    els.prizeClass.className = "tag";
    els.prizeStock.textContent = "no single unit available";
    els.prizeStock.className = "badge badge--out";
    els.prizePrice.textContent = "—";
    els.prizeCount.textContent = "";
    return;
  }

  els.prizeArt.innerHTML = carArt(car.name);
  els.prizeName.textContent = car.name;
  els.prizeClass.textContent = classify(car.name).label;
  els.prizeClass.className = "tag";
  els.prizeStock.textContent = `stock ${car.stock} — last unit`;
  els.prizeStock.className = "badge badge--low";
  els.prizePrice.textContent = coins(car.price);
  els.prizeCount.textContent = `car #${car.id}`;
}

function renderRacers() {
  [els.racer0, els.racer1].forEach((box, index) => {
    const player = state.players[index];
    box.replaceChildren();

    if (!player) {
      box.append(el("div", "racer__name", "No demo player"), el("div", "racer__wallet", "Run the development reset below."));
      return;
    }

    const outcome = state.outcomes[player.id];
    const walletNow = player.balance;

    box.append(
      el("div", "racer__name", player.name),
      el("div", "racer__wallet", `Player #${player.id} · wallet ${coins(walletNow)} coins`)
    );

    if (outcome) {
      const badge = el(
        "span",
        "badge" + (outcome.ok ? "" : " badge--out"),
        outcome.ok ? "purchase succeeded" : `purchase rejected (${outcome.status})`
      );
      box.append(badge);
      if (outcome.detail) box.append(el("div", "racer__wallet", outcome.detail));
    }

    const affordable = state.car ? state.car.price <= walletNow : false;
    box.append(
      el(
        "div",
        "tag",
        state.car
          ? affordable
            ? "can afford this unit"
            : "cannot afford this unit"
          : "waiting for stock"
      )
    );
  });
}

function renderStart() {
  const [a, b] = state.players;

  if (state.running) {
    els.start.disabled = true;
    els.start.textContent = "Racing…";
    els.start.classList.add("is-busy");
    return;
  }

  els.start.classList.remove("is-busy");

  if (!a || !b) {
    els.start.disabled = true;
    els.start.textContent = "Need two demo players";
    return;
  }

  if (!state.car) {
    els.start.disabled = true;
    els.start.textContent = "No last unit available";
    return;
  }

  if (state.completed) {
    els.start.disabled = true;
    els.start.textContent = "Race complete — reset to repeat";
    return;
  }

  els.start.disabled = false;
  els.start.textContent = `Race for the ${state.car.name}`;
}

function render() {
  renderPrize();
  renderRacers();
  renderStart();
}

function clearResults() {
  state.outcomes = {};
  state.before = {};
  state.winnerId = null;
  els.resultsSection.hidden = true;
  els.resultCards.replaceChildren();
  els.verdict.hidden = true;
  els.verdictChecks.replaceChildren();
  els.elapsed.textContent = "";
}

/* ------------------------------------------------------------------- race */

async function timedPurchase(playerId, carId) {
  const startedAt = performance.now();
  const key = crypto.randomUUID();

  try {
    const result = await api("POST", "/purchase", {
      body: { player_id: playerId, car_id: carId },
      headers: { "Idempotency-Key": key },
    });
    return { ...result, ms: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      data: { detail: `Network error: ${error?.message ?? error}` },
      ms: Math.round(performance.now() - startedAt),
    };
  }
}

function resultCard(player, result) {
  const created = result.status === 201;
  const soldOut = result.status === 409;
  const box = el(
    "div",
    "result " + (created ? "result--win" : soldOut ? "result--lose" : "")
  );

  const head = el("div", "result__head");
  head.append(el("span", "result__who", player.name));

  const code = el(
    "span",
    "status-code " + (created ? "status-code--ok" : "status-code--err"),
    isNetworkError(result) ? "no response" : String(result.status)
  );
  head.append(code);

  box.append(head);
  box.append(
    el(
      "div",
      "racer__wallet mono",
      isNetworkError(result) ? "request failed before a response" : `server responded in ${result.ms} ms`
    )
  );
  box.append(
    el("pre", "result__body", JSON.stringify(result.data, null, 2))
  );
  return box;
}

async function startRace() {
  if (state.running || !state.car || state.players.length < 2) return;

  const [a, b] = state.players;
  const car = state.car;

  state.running = true;
  state.completed = false;
  clearResults();
  setStatus("Both requests in flight…");
  render();

  state.before = { [a.id]: a.balance, [b.id]: b.balance };

  const startedAt = performance.now();

  // Both calls are created in the same tick; neither waits for the other.
  const results = await Promise.all([
    timedPurchase(a.id, car.id),
    timedPurchase(b.id, car.id),
  ]);

  const total = Math.round(performance.now() - startedAt);

  els.resultCards.append(
    resultCard(a, results[0]),
    resultCard(b, results[1])
  );
  els.resultsSection.hidden = false;
  els.elapsed.textContent = `both settled in ${total} ms`;

  state.outcomes = {
    [a.id]: {
      ok: results[0].status === 201,
      status: isNetworkError(results[0]) ? "network" : results[0].status,
      detail: results[0].status === 201 ? "wallet charged" : "no charge",
    },
    [b.id]: {
      ok: results[1].status === 201,
      status: isNetworkError(results[1]) ? "network" : results[1].status,
      detail: results[1].status === 201 ? "wallet charged" : "no charge",
    },
  };

  const verdict = await verify(car, [a, b], results);

  state.winnerId = verdict.winnerId;
  state.completed = true;
  state.running = false;
  setStatus(verdict.pass ? "Race complete — database re-read and verified." : "Race complete — verification failed, see checklist.");
  render();

  // Keep the wallet line honest after the race.
  if (verdict.after) {
    state.players = state.players.map((player) => ({
      ...player,
      balance: verdict.after[player.id] ?? player.balance,
    }));
  }
  renderRacers();
  renderVerdict(verdict);
}

/* ------------------------------------------------------------ verification */

function checklistItem(label, pass, detail) {
  const item = el("li", pass ? "pass" : "fail");
  const text = el("span");
  text.append(el("b", null, label));
  if (detail) {
    const note = el("span", null, ` — ${detail}`);
    text.append(note);
  }
  item.append(text);
  return item;
}

async function verify(car, players, results) {
  const checks = [];
  const created = results.filter((result) => result.status === 201);
  const winnerIndex = results.findIndex((result) => result.status === 201);
  const winner = winnerIndex >= 0 ? players[winnerIndex] : null;

  checks.push(
    checklistItem(
      "Exactly one request returned 201 Created",
      created.length === 1,
      `saw ${created.length} created response${created.length === 1 ? "" : "s"} (${results.map((r) => (isNetworkError(r) ? "network error" : r.status)).join(", ")})`
    )
  );

  const rejected = results.filter((result) => result.status !== 201);
  const allRejectedAre409 = rejected.length === 1 && rejected[0].status === 409;
  checks.push(
    checklistItem(
      "The other request was rejected with 409 Conflict",
      allRejectedAre409,
      rejected.length === 1
        ? `status ${isNetworkError(rejected[0]) ? "network error" : rejected[0].status}`
        : `${rejected.length} rejected response(s)`
    )
  );

  let carAfter = null;
  let after = {};
  let garages = [];

  try {
    const [cars, ...rest] = await Promise.all([
      getJson("/cars"),
      ...players.map((player) => getJson(`/players/${player.id}`)),
      ...players.map((player) => getJson(`/players/${player.id}/garage`)),
    ]);

    carAfter = Array.isArray(cars) ? cars.find((item) => item.id === car.id) ?? null : null;
    after = Object.fromEntries(
      players.map((player, index) => [player.id, rest[index]?.balance ?? null])
    );
    garages = players.map((player, index) => {
      const items = rest[players.length + index];
      return Array.isArray(items) ? items : [];
    });

    const stockZero = carAfter?.stock === 0;
    checks.push(
      checklistItem(
        "Vehicle stock is now 0 (re-read from the database)",
        stockZero,
        carAfter ? `GET /cars → stock ${carAfter.stock}` : "vehicle missing from GET /cars"
      )
    );

    const winnerId = winner?.id ?? null;
    const balanceChecks = players.map((player) => {
      const before = state.before[player.id] ?? null;
      const now = after[player.id];
      const expected = player.id === winnerId ? before - car.price : before;
      return { player, before, now, expected, pass: now === expected };
    });
    const balancesPass = balanceChecks.length === 2 && balanceChecks.every((check) => check.pass);
    checks.push(
      checklistItem(
        "Only the winner's wallet was debited",
        balancesPass,
        balanceChecks
          .map((check) =>
            check.before === null || check.now === null
              ? `${check.player.name}: balance unreadable`
              : `${check.player.name} ${coins(check.before)} → ${coins(check.now)}`
          )
          .join(" · ")
      )
    );

    const owners = players.map((player, index) => ({
      player,
      owns: garages[index].some((item) => item.car_id === car.id),
    }));
    const ownersPass =
      winner !== null &&
      owners.filter((owner) => owner.owns).length === 1 &&
      owners.find((owner) => owner.player.id === winner.id)?.owns === true;
    checks.push(
      checklistItem(
        "Exactly one garage contains the vehicle",
        ownersPass,
        owners.map((owner) => `${owner.player.name}: ${owner.owns ? "owns" : "no"}`).join(" · ")
      )
    );

    const pass = checks.every((item) => item.classList.contains("pass"));

    return {
      pass,
      checks,
      winnerId: winner?.id ?? null,
      after,
      note: winner
        ? `${winner.name} owns the final ${car.name}. The other request was refused before any money moved.`
        : "No buyer succeeded. Check the raw responses above and run the development reset.",
    };
  } catch (error) {
    checks.push(
      checklistItem(
        "Post-race database re-read succeeded",
        false,
        `could not verify: ${error?.message ?? error}`
      )
    );
    return {
      pass: false,
      checks,
      winnerId: null,
      after: {},
      note: "Verification could not complete. Treat the race as unproven.",
    };
  }
}

function renderVerdict(verdict) {
  els.verdict.hidden = false;
  els.verdict.className = "verdict " + (verdict.pass ? "verdict--pass" : "verdict--fail");

  els.verdictTitle.replaceChildren();
  const mark = el("span", "status-code " + (verdict.pass ? "status-code--ok" : "status-code--err"), verdict.pass ? "PASS" : "FAIL");
  els.verdictTitle.append(mark, el("span", null, verdict.pass ? "Exactly one purchase committed" : "Race did not behave as required"));

  els.verdictChecks.replaceChildren(...verdict.checks);
  els.verdictNote.textContent = verdict.note;
}

/* ------------------------------------------------------------------ reset */

async function resetDemo() {
  const confirmed = window.confirm(
    "DEVELOPMENT ONLY\n\n" +
      "This wipes all purchases and restores the two demo buyers and six vehicles. " +
      "The showroom and garage will be restocked.\n\nContinue?"
  );
  if (!confirmed) return;

  els.devReset.disabled = true;
  const result = await api("POST", "/dev/reset");
  els.devReset.disabled = false;

  if (result.ok) {
    toast(
      `Demo restored — ${result.data.players} players, ${result.data.cars} cars, ${result.data.purchases} purchases.`,
      "ok"
    );
    await boot();
    return;
  }

  toast(result.data?.detail ?? `Reset failed (${result.status}).`, "error");
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  clearResults();
  state.completed = false;
  state.running = false;
  setStatus("Loading players and inventory…");
  renderStart();

  try {
    const [players, cars] = await Promise.all([getJson("/players"), getJson("/cars")]);
    if (!Array.isArray(players) || !Array.isArray(cars)) {
      throw new Error("The API did not return players and cars.");
    }

    state.players = players.slice(0, 2);
    state.cars = cars;
    state.car = pickCar();

    render();

    if (state.players.length < 2) {
      setStatus("Two demo players are required. Run the development reset below.");
    } else if (!state.car) {
      setStatus(
        "No single-unit vehicle is affordable by both buyers right now. Run the development reset below."
      );
    } else {
      setStatus("Ready. Both purchase requests will fire in the same tick.");
    }
  } catch (error) {
    state.players = [];
    state.cars = [];
    state.car = null;
    render();
    setStatus(`Could not load the lab: ${error?.message ?? error}`);
  }
}

els.start.addEventListener("click", startRace);
els.devReset.addEventListener("click", resetDemo);

boot();
