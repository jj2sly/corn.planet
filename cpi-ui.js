// =========================================
// CPI DATABASE UI COMPONENTS
// Small shared builders for the archive lists. Text goes in with textContent only, so record
// titles can never inject markup. Only fields a list page already reads are shown.
// =========================================

/**
 * One archive row:
 *   [ RECORD TYPE ]  ID
 *   TITLE            (optional subtitle)
 *   KEY // VALUE stamps
 *   OPEN RECORD ▸
 * tags: [{ key, value, color? }] — color is the record's existing badge colour, used as an accent.
 */
export function recordCard({ href, id, type, title, subtitle = "", tags = [] }) {
    const card = document.createElement("article");
    card.className = "recordCard";

    const head = document.createElement("div");
    head.className = "recordHead";
    const typeEl = document.createElement("span");
    typeEl.className = "recordType";
    typeEl.textContent = type;
    const idEl = document.createElement("span");
    idEl.className = "recordId";
    idEl.textContent = id;
    head.append(typeEl, idEl);

    const link = document.createElement("a");
    link.className = "recordTitle";
    link.href = href;
    link.textContent = title;

    card.append(head, link);

    if (subtitle) {
        const sub = document.createElement("p");
        sub.className = "recordSub";
        sub.textContent = subtitle;
        card.append(sub);
    }

    if (tags.length) {
        const row = document.createElement("div");
        row.className = "recordTags";
        for (const t of tags) {
            if (!t.value) continue;
            const stamp = document.createElement("span");
            stamp.className = "stamp";
            stamp.dataset.key = t.key.toUpperCase();
            stamp.dataset.value = t.value.toUpperCase();
            if (t.color) stamp.style.setProperty("--stamp", t.color);
            const k = document.createElement("span");
            k.className = "stampKey";
            k.textContent = t.key;
            const v = document.createElement("span");
            v.className = "stampVal";
            v.textContent = t.value;
            stamp.append(k, v);
            row.append(stamp);
        }
        card.append(row);
    }

    const open = document.createElement("span");
    open.className = "recordOpen";
    open.setAttribute("aria-hidden", "true");
    open.textContent = "OPEN RECORD ▸";
    card.append(open);
    return card;
}
