/* Small shared helpers for both pages. No dependencies. */

export async function api(method, path, { body, headers } = {}) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* empty or non-JSON body */
  }
  return { status: response.status, ok: response.ok, data };
}

export const coins = (n) => new Intl.NumberFormat("en-US").format(Number(n) ?? 0);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function formatDate(value) {
  if (!value) return "";
  const parsed = new Date(String(value).replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ownershipId = (purchaseId) =>
  `SIM-${String(purchaseId).padStart(5, "0")}`;
