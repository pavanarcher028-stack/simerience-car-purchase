/* SIMERIENCE showroom front end.
 *
 * Talks to the existing FastAPI backend and nothing else:
 *   GET  /players, /players/{id}, /players/{id}/garage, /cars
 *   POST /purchase  (requires an Idempotency-Key header)
 *
 * The purchase protections live in app/store.py. This file only has to respect
 * two rules: one fresh key per attempt, and the *same* key when retrying.
 */

const els = {
  playerSelect: document.getElementById("player-select"),
  balance: document.getElementById("balance-value"),
  balanceBox: document.querySelector(".balance"),
  grid: document.getElementById("car-grid"),
  shopEmpty: document.getElementById("shop-empty"),
  garage: document.getElementById("garage-list"),
  garageEmpty: document.getElementById("garage-empty"),
  garageCount: document.getElementById("garage-count"),
  log: document.getElementById("log"),
  retry: document.getElementById("retry"),
  refresh: document.getElementById("refresh"),
  toast: document.getElementById("toast"),
};

const state = {
  players: [],
  cars: [],
  playerId: null,
  busy: new Set(),      // car ids with a request in flight
  lastAttempt: null,    // { playerId, carId, key } for the retry button
  logs: [],
};

/* ------------------------------------------------------------------ helpers */

const coins = (n) => new Intl.NumberFormat("en-US").format(n ?? 0);
const carEmoji = (name) => {
  const n = name.toLowerCase();
  if (n.includes("suv") || n.includes("truck")) return "🚙";
  if (n.includes("hatch") || n.includes("compact")) return "🚗";
  if (n.includes("sport") || n.includes("super")) return "🏎️";
  return "🚘";
};

async function api(method, path, { body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  return { status: res.status, ok: res.ok, data };
}

let toastTimer = null;
function toast(message, kind = "") {
  els.toast.textContent = message;
  els.toast.className = `toast show ${kind}`;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("show");
    setTimeout(() => {
      els.toast.hidden = true;
    }, 250);
  }, 3200);
}

/* --------------------------------------------------------------------- data */

async function loadPlayers() {
  const { ok, data } = await api("GET", "/players");
  state.players = ok ? data : [];

  els.playerSelect.replaceChildren(
    ...state.players.map((p) => {
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = p.name;
      return opt;
    })
  );

  if (!state.players.length) {
    els.balance.textContent = "—";
    return;
  }
  const remembered = Number(localStorage.getItem("simerience:player"));
  const exists = state.players.some((p) => p.id === remembered);
  state.playerId = exists ? remembered : state.players[0].id;
  els.playerSelect.value = String(state.playerId);
  renderBalance();
}

async function loadShop() {
  const { ok, data } = await api("GET", "/cars");
  state.cars = ok ? data : [];
  renderShop();
}

async function loadGarage() {
  if (!state.playerId) return;
  const { ok, data } = await api("GET", `/players/${state.playerId}/garage`);
  renderGarage(ok ? data : []);
}

async function refreshAll({ balanceFlash = false } = {}) {
  await loadPlayers();
  await Promise.all([loadShop(), loadGarage()]);
  if (balanceFlash) {
    els.balanceBox.classList.remove("flash");
    void els.balanceBox.offsetWidth; // restart the animation
    els.balanceBox.classList.add("flash");
  }
}

/* ------------------------------------------------------------------ render */

function currentPlayer() {
  return state.players.find((p) => p.id === state.playerId) ?? null;
}

function renderBalance() {
  const player = currentPlayer();
  els.balance.textContent = player ? coins(player.balance) : "—";
}

function renderShop() {
  els.grid.replaceChildren();
  els.shopEmpty.hidden = state.cars.length > 0;

  for (const car of state.cars) {
    const card = document.createElement("article");
    card.className = "car" + (car.stock === 0 ? " sold-out" : "");

    const head = document.createElement("div");
    head.className = "car-head";

    const emoji = document.createElement("span");
    emoji.className = "car-emoji";
    emoji.setAttribute("aria-hidden", "true");
    emoji.textContent = carEmoji(car.name);

    const title = document.createElement("h3");
    title.textContent = car.name;

    const stock = document.createElement("span");
    stock.className =
      "stock " + (car.stock === 0 ? "none" : car.stock <= 1 ? "low" : "");
    stock.textContent =
      car.stock === 0 ? "Sold out" : car.stock === 1 ? "1 left" : `${car.stock} left`;

    head.append(emoji, title, stock);

    const price = document.createElement("div");
    price.className = "price";
    price.innerHTML = `<span class="coin" aria-hidden="true">◎</span> ${coins(car.price)}`;

    const affordable = currentPlayer() && currentPlayer().balance >= car.price;
    const btn = document.createElement("button");
    btn.className = "buy";
    btn.type = "button";
    btn.dataset.carId = String(car.id);

    if (car.stock === 0) {
      btn.textContent = "Sold out";
      btn.disabled = true;
    } else if (!currentPlayer()) {
      btn.textContent = "No player selected";
      btn.disabled = true;
    } else if (!affordable) {
      btn.textContent = "Not enough coins";
      btn.disabled = true;
    } else {
      btn.textContent = "Buy for " + coins(car.price);
      btn.addEventListener("click", () => purchase(car.id));
    }

    if (state.busy.has(car.id)) {
      btn.classList.add("busy");
      btn.disabled = true;
    }

    card.append(head, price, btn);
    els.grid.append(card);
  }
}

function renderGarage(items) {
  els.garage.replaceChildren();
  els.garageEmpty.hidden = items.length > 0;
  els.garageCount.textContent = items.length
    ? `${items.length} car${items.length === 1 ? "" : "s"}`
    : "";
  els.garageCount.hidden = items.length === 0;

  for (const item of items) {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.className = "name";
    name.innerHTML = `<span aria-hidden="true">${carEmoji(item.car_name)}</span>`;
    const label = document.createElement("span");
    label.textContent = item.car_name;
    name.append(label);

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `paid ${coins(item.price_paid)} coins`;

    li.append(name, meta);
    els.garage.append(li);
  }
}

function renderLogs() {
  if (!state.logs.length) {
    els.log.innerHTML =
      '<p class="empty">Requests appear here, with the status the backend returned.</p>';
    return;
  }

  els.log.replaceChildren(
    ...state.logs.map((entry) => {
      const row = document.createElement("div");
      row.className = "log-row" + (entry.replayed ? " replayed" : "");

      const time = document.createElement("time");
      time.textContent = entry.time;

      const desc = document.createElement("span");
      desc.className = "desc";
      desc.textContent = entry.message;

      const key = document.createElement("span");
      key.className = "key";
      key.textContent = entry.key ? entry.key.slice(0, 8) : "";

      const status = document.createElement("span");
      const kind = entry.replayed ? "replay" : entry.ok ? "ok" : "bad";
      status.className = "status " + kind;
      status.textContent = entry.replayed ? `201 replayed` : String(entry.status);

      row.append(time, desc, key, status);
      return row;
    })
  );
}

function addLog(entry) {
  state.logs.unshift({
    time: new Date().toLocaleTimeString([], { hour12: false }),
    ...entry,
  });
  state.logs = state.logs.slice(0, 12);
  renderLogs();
}

/* ---------------------------------------------------------------- purchase */

async function purchase(carId, { key = crypto.randomUUID(), isRetry = false } = {}) {
  if (!state.playerId || state.busy.has(carId)) return;

  const car = state.cars.find((c) => c.id === carId);
  const player = currentPlayer();
  const payload = { player_id: state.playerId, car_id: carId };

  state.busy.add(carId);
  state.lastAttempt = { playerId: state.playerId, carId, key };
  els.retry.disabled = false;
  renderShop();

  let result;
  try {
    result = await api("POST", "/purchase", {
      body: payload,
      headers: { "Idempotency-Key": key },
    });
  } catch (networkError) {
    // The request may or may not have reached the server. Retry once with the
    // SAME key: if it did land, the backend replays instead of charging twice.
    addLog({
      status: "—",
      ok: false,
      key,
      message: `Network error buying ${car?.name ?? "car"} — retrying with the same key`,
    });
    try {
      result = await api("POST", "/purchase", {
        body: payload,
        headers: { "Idempotency-Key": key },
      });
    } catch {
      state.busy.delete(carId);
      renderShop();
      toast("Could not reach the server. Your coins were not touched.", "error");
      return;
    }
  }

  state.busy.delete(carId);

  const { status, ok, data } = result;

  if (ok && data) {
    const wasReplay = data.replayed;
    addLog({
      status,
      ok: true,
      replayed: wasReplay,
      key,
      message: wasReplay
        ? `Retry replayed — ${data.car_name} was already bought, no second charge`
        : `${player?.name ?? "Player"} bought ${data.car_name} for ${coins(data.price_paid)}`,
    });
    toast(
      wasReplay
        ? `Already purchased — replayed, no coins taken.`
        : `${data.car_name} added to your garage. -${coins(data.price_paid)} coins`,
      "success"
    );
    await refreshAll({ balanceFlash: true });
    return;
  }

  const detail = data?.detail ?? "Purchase failed.";

  if (status === 409 && /sold out/i.test(detail)) {
    toast(`${car?.name ?? "That car"} just sold out. No coins were taken.`, "error");
  } else if (status === 400) {
    toast(detail, "error");
  } else if (status === 409) {
    toast(detail, "error");
  } else {
    toast(detail, "error");
  }

  addLog({ status, ok: false, key, message: detail });
  await refreshAll();
}

/* ------------------------------------------------------------------ events */

els.playerSelect.addEventListener("change", async (event) => {
  state.playerId = Number(event.target.value);
  localStorage.setItem("simerience:player", String(state.playerId));
  renderBalance();
  renderShop();
  await loadGarage();
});

els.refresh.addEventListener("click", () => refreshAll({ balanceFlash: true }));

els.retry.addEventListener("click", () => {
  if (!state.lastAttempt) return;
  const { playerId, carId, key } = state.lastAttempt;
  if (playerId !== state.playerId) {
    toast("Switch back to that player to retry the request.", "error");
    return;
  }
  purchase(carId, { key, isRetry: true });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshAll();
});

renderLogs();
refreshAll().catch(() => toast("Could not load the showroom.", "error"));
