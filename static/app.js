/* SIMERIENCE · Motorworks — showroom client
 *
 * Talks only to the existing FastAPI endpoints:
 *   GET  /players, /players/{id}, /players/{id}/garage, /cars
 *   POST /purchase   (requires an Idempotency-Key header)
 *
 * Purchase protections live in app/store.py. The client's job is to send one
 * fresh key per attempt, reuse the same key when retrying after a network
 * failure, and show whatever the server actually returned.
 */

import { api, coins, el, formatDate, ownershipId } from "./api.js";
import { carArt, classify } from "./art.js";

const els = {
  playerSelect: document.getElementById("player-select"),
  wallet: document.getElementById("wallet"),
  walletValue: document.getElementById("wallet-value"),
  heroArt: document.getElementById("hero-art"),
  heroName: document.getElementById("hero-name"),
  heroClass: document.getElementById("hero-class"),
  heroStock: document.getElementById("hero-stock"),
  heroNote: document.getElementById("hero-note"),
  heroPrice: document.getElementById("hero-price"),
  heroBuy: document.getElementById("hero-buy"),
  heroGarage: document.getElementById("hero-garage"),
  filters: document.getElementById("filters"),
  search: document.getElementById("search"),
  sort: document.getElementById("sort"),
  grid: document.getElementById("grid"),
  shopCount: document.getElementById("shop-count"),
  shopError: document.getElementById("shop-error"),
  shopErrorText: document.getElementById("shop-error-text"),
  shopRetry: document.getElementById("shop-retry"),
  shopEmpty: document.getElementById("shop-empty"),
  garage: document.getElementById("garage"),
  garageEmpty: document.getElementById("garage-empty"),
  garageCount: document.getElementById("garage-count"),
  garageSection: document.getElementById("garage-section"),
  modalRoot: document.getElementById("modal-root"),
  toasts: document.getElementById("toasts"),
};

const FILTERS = [
  ["all", "All"],
  ["coupe", "Sport"],
  ["suv", "SUV"],
  ["truck", "Off-road"],
  ["hatch", "Compact"],
  ["sedan", "Luxury"],
  ["owned", "In garage"],
];

const state = {
  players: [],
  playerId: null,
  cars: [],
  garage: [],
  filter: "all",
  query: "",
  sort: "featured",
  selectedId: null,
  loading: true,
  lastFocus: null,
  closeModal: null,
};

/* ---------------------------------------------------------------- derived */

const ownedIds = () => new Set(state.garage.map((item) => item.car_id));
const currentPlayer = () => state.players.find((p) => p.id === state.playerId) ?? null;
const wallet = () => currentPlayer()?.balance ?? 0;

function stockLabel(car) {
  if (car.stock === 0) return "Sold out";
  if (car.stock === 1) return "1 unit left";
  return `${car.stock} units`;
}

function stockBadgeClass(car) {
  if (car.stock === 0) return "badge badge--out";
  if (car.stock === 1) return "badge badge--low";
  return "badge";
}

function toast(message, kind = "") {
  const node = el("div", `toast${kind ? " toast--" + kind : ""}`, message);
  node.setAttribute("role", "status");
  els.toasts.append(node);
  setTimeout(() => node.remove(), 4200);
}

/* ------------------------------------------------------------------- data */

async function loadPlayers() {
  const { ok, data } = await api("GET", "/players");
  state.players = ok && Array.isArray(data) ? data : [];

  els.playerSelect.replaceChildren(
    ...state.players.map((player) => {
      const option = el("option", null, `${player.name} · ${coins(player.balance)}`);
      option.value = String(player.id);
      return option;
    })
  );

  const remembered = Number(localStorage.getItem("simerience:player"));
  const known = state.players.some((p) => p.id === remembered);
  state.playerId = state.players.length
    ? known
      ? remembered
      : state.players[0].id
    : null;

  if (state.playerId !== null) els.playerSelect.value = String(state.playerId);
  els.playerSelect.disabled = state.players.length === 0;
  renderWallet();
}

async function loadCars() {
  const { ok, data } = await api("GET", "/cars");
  if (!ok || !Array.isArray(data)) {
    showShopError("The showroom could not reach the dealership API.");
    return false;
  }
  state.cars = data;
  els.shopError.hidden = true;
  return true;
}

async function loadGarage() {
  if (state.playerId === null) {
    state.garage = [];
    return;
  }
  const { ok, data } = await api("GET", `/players/${state.playerId}/garage`);
  state.garage = ok && Array.isArray(data) ? data : [];
}

/* Balances change on purchase, so re-read them without resetting the selection. */
async function loadBalances() {
  const { ok, data } = await api("GET", "/players");
  if (!ok || !Array.isArray(data)) return;
  state.players = data;
  for (const option of els.playerSelect.options) {
    const player = state.players.find((p) => String(p.id) === option.value);
    if (player) option.textContent = `${player.name} · ${coins(player.balance)}`;
  }
}

async function refresh({ flashWallet = false } = {}) {
  await loadBalances();
  const ok = await loadCars();
  await loadGarage();
  renderAll();
  if (ok && flashWallet) {
    els.wallet.classList.remove("is-flashing");
    void els.wallet.offsetWidth;
    els.wallet.classList.add("is-flashing");
  }
}

/* ----------------------------------------------------------------- render */

function renderWallet() {
  els.walletValue.textContent = currentPlayer() ? coins(wallet()) : "—";
}

function renderAll() {
  renderWallet();
  renderHero();
  renderFilters();
  renderGrid();
  renderGarage();
}

function renderFilters() {
  if (els.filters.childElementCount === 0) {
    for (const [value, label] of FILTERS) {
      const chip = el("button", "chip", label);
      chip.type = "button";
      chip.dataset.value = value;
      chip.addEventListener("click", () => {
        state.filter = value;
        renderFilters();
        renderGrid();
      });
      els.filters.append(chip);
    }
  }
  for (const chip of els.filters.children) {
    chip.setAttribute("aria-pressed", String(chip.dataset.value === state.filter));
  }
}

function selectedCar() {
  if (state.selectedId !== null) {
    const found = state.cars.find((car) => car.id === state.selectedId);
    if (found) return found;
  }
  return state.cars.find((car) => car.stock > 0) ?? state.cars[0] ?? null;
}

function renderHero() {
  const car = selectedCar();
  if (!car) {
    els.heroName.textContent = "Showroom closed";
    els.heroClass.textContent = "—";
    els.heroStock.textContent = "No stock";
    els.heroStock.className = "badge badge--out";
    els.heroPrice.textContent = "—";
    els.heroNote.textContent = "Add vehicles to the database to open the floor.";
    els.heroArt.replaceChildren();
    els.heroBuy.disabled = true;
    els.heroBuy.textContent = "Reserve vehicle";
    return;
  }

  const owned = ownedIds().has(car.id);
  els.heroName.textContent = car.name;
  els.heroClass.textContent = classify(car.name).label;
  els.heroStock.textContent = stockLabel(car);
  els.heroStock.className = stockBadgeClass(car);
  els.heroPrice.textContent = coins(car.price);
  els.heroArt.innerHTML = carArt(car.name);

  els.heroNote.textContent = owned
    ? "Already parked in your garage."
    : car.stock === 0
      ? "All units sold. Check back after the next allocation."
      : car.stock === 1
        ? "Final unit allocated to this floor."
        : `${car.stock} units on the floor.`;

  const affordable = wallet() >= car.price;
  els.heroBuy.disabled = car.stock === 0 || !affordable || !currentPlayer();
  els.heroBuy.textContent =
    car.stock === 0
      ? "Sold out"
      : !currentPlayer()
        ? "Select a player"
        : !affordable
          ? `Need ${coins(car.price - wallet())} more`
          : `Reserve · ${coins(car.price)}`;
}

function visibleCars() {
  const owned = ownedIds();
  let list = [...state.cars];

  if (state.filter === "owned") list = list.filter((car) => owned.has(car.id));
  else if (state.filter !== "all") {
    list = list.filter((car) => classify(car.name).kind === state.filter);
  }

  if (state.query) {
    const query = state.query.toLowerCase();
    list = list.filter((car) => car.name.toLowerCase().includes(query));
  }

  switch (state.sort) {
    case "price-asc":
      list.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      list.sort((a, b) => b.price - a.price);
      break;
    case "stock":
      list.sort((a, b) => b.stock - a.stock || a.price - b.price);
      break;
    default:
      break;
  }
  return list;
}

function renderGrid() {
  const list = visibleCars();
  els.grid.replaceChildren();

  if (state.loading) {
    for (let i = 0; i < 3; i += 1) {
      const skeleton = el("div", "card card--skeleton");
      skeleton.append(el("div", "card__stage skeleton"), el("div", "card__body"));
      els.grid.append(skeleton);
    }
    els.shopCount.textContent = "";
    els.shopEmpty.hidden = true;
    return;
  }

  for (const car of list) els.grid.append(cardFor(car));

  const total = state.cars.length;
  els.shopCount.textContent =
    total === 0 ? "" : `${list.length} of ${total} vehicles`;
  els.shopEmpty.hidden = list.length > 0;

  const active = selectedCar();
  if (active) state.selectedId = active.id;
}

function cardFor(car) {
  const owned = ownedIds().has(car.id);
  const affordable = wallet() >= car.price;
  const soldOut = car.stock === 0;

  const card = el(
    "article",
    "card" + (soldOut ? " is-sold-out" : "") + (state.selectedId === car.id ? " is-selected" : "")
  );
  card.dataset.carId = String(car.id);

  const stage = el("div", "card__stage");
  stage.innerHTML = carArt(car.name);

  const body = el("div", "card__body");
  body.append(el("h3", "card__title", car.name));

  const sub = el("div", "card__sub");
  sub.append(el("span", "tag", classify(car.name).label));
  const badges = el("span", null, null);
  badges.style.display = "inline-flex";
  badges.style.gap = "8px";
  if (owned) badges.append(el("span", "badge badge--owned", "In garage"));
  badges.append(el("span", stockBadgeClass(car), stockLabel(car)));
  sub.append(badges);

  const footer = el("div", "card__footer");
  const price = el("div", "price");
  price.append(document.createTextNode(coins(car.price)), el("small", null, "coins"));

  const actions = el("div", "card__actions");

  const view = el("button", "btn btn--quiet btn--sm", "View");
  view.type = "button";
  view.addEventListener("click", () => {
    state.selectedId = car.id;
    renderHero();
    renderGrid();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const buy = el("button", "btn btn--primary btn--sm");
  buy.type = "button";
  if (soldOut) {
    buy.textContent = "Sold out";
    buy.disabled = true;
  } else if (!affordable) {
    buy.textContent = "Not enough";
    buy.disabled = true;
    buy.title = `You need ${coins(car.price - wallet())} more coins.`;
  } else {
    buy.textContent = "Reserve";
    buy.addEventListener("click", () => openPurchase(car));
  }

  actions.append(view, buy);
  footer.append(price, actions);
  body.append(sub, footer);
  card.append(stage, body);
  return card;
}

function renderGarage() {
  const items = [...state.garage].reverse();
  els.garage.replaceChildren();
  els.garageEmpty.hidden = items.length > 0;
  els.garageCount.textContent = items.length
    ? `${items.length} vehicle${items.length === 1 ? "" : "s"}`
    : "";

  for (const item of items) {
    const row = el("div", "garage__row");

    const thumb = el("div", "garage__thumb");
    thumb.innerHTML = carArt(item.car_name);

    const info = el("div");
    info.append(
      el("div", "garage__name", item.car_name),
      el("div", "garage__id", `Ownership ${ownershipId(item.purchase_id)}`)
    );

    const paid = el("div", "garage__paid");
    paid.append(document.createTextNode(`${coins(item.price_paid)} coins`));

    const date = el("div", "garage__date", formatDate(item.purchased_at));

    row.append(thumb, info, paid, date);
    els.garage.append(row);
  }
}

function showShopError(message) {
  state.loading = false;
  els.shopError.hidden = false;
  els.shopErrorText.textContent = message;
  els.grid.replaceChildren();
  els.shopCount.textContent = "";
}

/* ------------------------------------------------------------------ modal */

function openModal(build) {
  closeModal();

  const backdrop = el("div", "modal-backdrop");
  const panel = el("div", "modal");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "modal-title");
  backdrop.append(panel);
  els.modalRoot.append(backdrop);

  state.lastFocus = document.activeElement;

  const close = () => {
    backdrop.remove();
    state.closeModal = null;
    if (state.lastFocus instanceof HTMLElement) state.lastFocus.focus();
  };
  state.closeModal = close;

  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = panel.querySelectorAll(
      'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKey);

  const originalClose = close;
  state.closeModal = () => {
    document.removeEventListener("keydown", onKey);
    originalClose();
  };

  build(panel, state.closeModal);
  panel.querySelector("button, [href]")?.focus();
}

function closeModal() {
  state.closeModal?.();
}

function modalHeader(panel, title) {
  const head = el("div", "modal__head");
  const heading = el("h2", null, title);
  heading.id = "modal-title";
  const close = el("button", "icon-btn", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeModal);
  head.append(heading, close);
  panel.append(head);
  return head;
}

function openPurchase(car) {
  const player = currentPlayer();
  if (!player) {
    toast("Choose a player first.", "error");
    return;
  }
  if (car.stock === 0) {
    toast(`${car.name} is sold out.`, "error");
    return;
  }

  openModal((panel, close) => {
    modalHeader(panel, "Confirm reservation");

    const art = el("div", "modal__art");
    art.innerHTML = carArt(car.name);
    panel.append(art);

    const list = el("dl", "summary");
    const row = (label, value, extra = "") => {
      const wrap = el("div", `summary__row${extra}`);
      wrap.append(el("dt", null, label), el("dd", null, value));
      list.append(wrap);
    };

    const after = player.balance - car.price;
    row("Vehicle", car.name);
    row("Class", classify(car.name).label);
    row("Price", `${coins(car.price)} coins`);
    row("Wallet now", `${coins(player.balance)} coins`);
    row("Wallet after", `${coins(after)} coins`, " summary__row--total");
    row("Stock after", car.stock === 1 ? "0 units (sold out)" : `${car.stock - 1} units`);
    panel.append(list);

    const note = el(
      "p",
      "modal__note",
      "The server checks stock and your balance inside one database transaction. " +
        "If either check fails, nothing is charged."
    );
    panel.append(note);

    const errorBox = el("div", "alert alert--error");
    errorBox.hidden = true;
    panel.append(errorBox);

    const actions = el("div", "modal__actions");
    const cancel = el("button", "btn btn--ghost", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", close);

    const confirm = el("button", "btn btn--primary", `Confirm · ${coins(car.price)}`);
    confirm.type = "button";
    actions.append(cancel, confirm);
    panel.append(actions);

    let key = crypto.randomUUID();
    let submitting = false;

    const submit = async ({ retrySameKey = false } = {}) => {
      if (submitting) return;
      submitting = true;
      errorBox.hidden = true;
      confirm.classList.add("is-busy");
      confirm.disabled = true;
      cancel.disabled = true;

      if (!retrySameKey) key = crypto.randomUUID();

      let result;
      try {
        result = await api("POST", "/purchase", {
          body: { player_id: player.id, car_id: car.id },
          headers: { "Idempotency-Key": key },
        });
      } catch {
        // Network failure: the request may still have landed. Retry once with the
        // same key so the server replays instead of charging a second time.
        try {
          result = await api("POST", "/purchase", {
            body: { player_id: player.id, car_id: car.id },
            headers: { "Idempotency-Key": key },
          });
        } catch {
          submitting = false;
          confirm.classList.remove("is-busy");
          confirm.disabled = false;
          cancel.disabled = false;
          errorBox.hidden = false;
          errorBox.textContent =
            "Could not reach the server. Nothing was charged — check that the API is running.";
          return;
        }
      }

      if (result.ok && result.data) {
        // The server told us the exact remaining balance — use it immediately so
        // the wallet never lags behind the receipt while refresh() is in flight.
        const account = state.players.find((p) => p.id === player.id);
        if (account) account.balance = result.data.balance_after;
        renderWallet();

        showReceipt(panel, close, car, result.data, player);
        await refresh();
        toast(
          result.data.replayed
            ? "Already reserved — replayed, no second charge."
            : `${car.name} added to your garage.`,
          "ok"
        );
        return;
      }

      submitting = false;
      confirm.classList.remove("is-busy");
      confirm.disabled = false;
      cancel.disabled = false;

      const detail = result.data?.detail ?? `Purchase failed (${result.status}).`;
      errorBox.hidden = false;
      errorBox.textContent = detail;

      // The floor changes under us: refresh so the page matches the database.
      await refresh();
    };

    confirm.addEventListener("click", () => submit());
  });
}

function showReceipt(panel, close, car, data, player) {
  panel.replaceChildren();
  modalHeader(panel, "Reservation complete");

  const body = el("div", "receipt");
  const check = el("div", "receipt__check");
  check.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
    '<path d="M4 10.5l4 4 8-9" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  body.append(check);

  const title = el("h2", null, data.replayed ? "Already in your garage" : "Purchase complete");
  const lead = el(
    "p",
    "modal__note",
    data.replayed
      ? "This request reused an earlier transaction key, so the server returned the original reservation instead of charging again."
      : `${player.name}, your ${car.name} is ready for pickup on the Motorworks floor.`
  );
  body.append(title, lead);

  const list = el("dl", "summary");
  const row = (label, value, extra = "") => {
    const wrap = el("div", `summary__row${extra}`);
    wrap.append(el("dt", null, label), el("dd", null, value));
    list.append(wrap);
  };
  row("Ownership ID", ownershipId(data.purchase_id));
  row("Vehicle", data.car_name);
  row("Paid", `${coins(data.price_paid)} coins`);
  row("Wallet now", `${coins(data.balance_after)} coins`, " summary__row--total");
  row("Units left", `${data.stock_after} of this model`, "");
  body.append(list);

  const actions = el("div", "modal__actions");
  const garageBtn = el("button", "btn btn--quiet", "Go to garage");
  garageBtn.type = "button";
  garageBtn.addEventListener("click", () => {
    close();
    els.garageSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const done = el("button", "btn btn--primary", "Done");
  done.type = "button";
  done.addEventListener("click", close);
  actions.append(garageBtn, done);

  body.append(actions);
  panel.append(body);
  done.focus();
}

/* ----------------------------------------------------------------- events */

els.playerSelect.addEventListener("change", async (event) => {
  state.playerId = Number(event.target.value);
  localStorage.setItem("simerience:player", String(state.playerId));
  await loadGarage();
  renderAll();
});

els.search.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  renderGrid();
});

els.sort.addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderGrid();
});

els.heroBuy.addEventListener("click", () => {
  const car = selectedCar();
  if (car) openPurchase(car);
});

els.heroGarage.addEventListener("click", () => {
  els.garageSection.scrollIntoView({ behavior: "smooth", block: "start" });
});

els.shopRetry.addEventListener("click", async () => {
  state.loading = true;
  renderGrid();
  await refresh();
  state.loading = false;
  renderGrid();
});

/* ------------------------------------------------------------------- boot */

async function boot() {
  renderGrid();
  try {
    await loadPlayers();
    await Promise.all([loadCars(), loadGarage()]);
  } catch {
    showShopError("The showroom could not reach the dealership API.");
  }
  state.loading = false;
  renderAll();
}

boot();
