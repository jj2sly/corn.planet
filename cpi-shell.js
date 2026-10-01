// =========================================
// CPI DATABASE SHELL
// Shared on every page. It:
//   1. tags <body> with the page type (cpHome / cpList / cpDossier / cpConsole / cpAuth) so
//      style.css can lay each kind of page out consistently;
//   2. adds the top system bar: CPI wordmark, the database sections, and the visitor's real
//      clearance (Records Division and Admin appear only for roles that can open them — the
//      same checks nav-auth.js used to make; the pages themselves still enforce access);
//   3. formats "LABEL: VALUE" record tags (classification, containment, severity, status…)
//      as terminal stamps, without changing what the record scripts write.
// Presentation only: it never writes to Firestore or changes auth.
// =========================================

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth, can, ensureUserDoc, getUserRole, ROLES } from "./roles.js";

const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();

const PAGE_TYPE = {
    "index.html": "cpHome",
    "entities.html": "cpList",
    "artifacts.html": "cpList",
    "incidents.html": "cpList",
    "personnel.html": "cpList",
    "classification.html": "cpList",
    "entry.html": "cpDossier",
    "artifact-entry.html": "cpDossier",
    "incident-entry.html": "cpDossier",
    "personnel-entry.html": "cpDossier",
    "records.html": "cpConsole",
    "admin.html": "cpConsole",
    "login.html": "cpAuth",
    "signup.html": "cpAuth"
};

// Which section a page belongs to (record pages light up their list's section).
const SECTION_OF = {
    "index.html": "index.html",
    "classification.html": "classification.html",
    "entities.html": "entities.html",
    "entry.html": "entities.html",
    "artifacts.html": "artifacts.html",
    "artifact-entry.html": "artifacts.html",
    "incidents.html": "incidents.html",
    "incident-entry.html": "incidents.html",
    "personnel.html": "personnel.html",
    "personnel-entry.html": "personnel.html",
    "records.html": "records.html",
    "admin.html": "admin.html"
};

const SECTIONS = [
    ["index.html", "Home"],
    ["classification.html", "Classifications"],
    ["entities.html", "Entities"],
    ["artifacts.html", "Artifacts"],
    ["incidents.html", "Incidents"],
    ["personnel.html", "Personnel"]
];

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "text") node.textContent = v;
        else if (k === "class") node.className = v;
        else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c) node.append(c);
    return node;
}

function navLink(href, label) {
    const current = SECTION_OF[page] === href;
    return el("li", {}, el("a", { href, class: "sysLink", "aria-current": current ? "page" : null, text: label }));
}

function buildBar() {
    const links = el("ul", { class: "sysLinks", id: "sysLinks" }, SECTIONS.map(([href, label]) => navLink(href, label)));
    const records = navLink("records.html", "Records Division");
    const admin = navLink("admin.html", "Admin");
    records.hidden = true;
    admin.hidden = true;
    links.append(records, admin);

    const clearance = el("span", { class: "sysClearance", id: "sysClearance" }, el("span", { class: "sysKey", text: "Clearance" }), el("span", { class: "sysVal", text: "Guest" }));
    const account = el("a", { class: "sysAccount", href: "login.html", text: "Login / Sign up" });
    const toggle = el("button", { class: "sysToggle", type: "button", "aria-expanded": "false", "aria-controls": "sysLinks", text: "Sections" });
    toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", String(open));
        bar.classList.toggle("open", open);
    });

    const bar = el(
        "nav",
        { class: "sysBar", "aria-label": "CPI Database" },
        el("a", { class: "sysBrand", href: "index.html" }, el("span", { class: "sysMark", "aria-hidden": "true", text: "CPI" }), el("span", { class: "sysName", text: "Database" })),
        toggle,
        links,
        el(
            "div",
            { class: "sysStatus" },
            // A fixed label, not telemetry.
            el("span", { class: "sysChannel", "aria-hidden": "true" }, el("span", { class: "sysKey", text: "Archive link" }), el("span", { class: "sysVal", text: "Secure" })),
            clearance,
            account
        )
    );
    return { bar, records, admin, clearance, account };
}

function watchAuth({ records, admin, clearance, account }) {
    onAuthStateChanged(auth, async (user) => {
        const val = clearance.querySelector(".sysVal");
        if (!user) {
            val.textContent = "Guest";
            account.hidden = false;
            records.hidden = true;
            admin.hidden = true;
            return;
        }
        account.hidden = true;
        try {
            await ensureUserDoc(user);
        } catch {
            // The pages that need the user doc create it themselves; the bar just shows what it can.
        }
        const role = await getUserRole(user.uid);
        const info = Object.values(ROLES).find((r) => r.id === role);
        val.textContent = info ? info.label : role;
        clearance.dataset.role = role;
        records.hidden = !can.accessRecordsDivision(role);
        admin.hidden = !can.accessSuperAdminPanel(role);
    });
}

// "CLASSIFICATION: COSMIC" -> a stamp with a key and a value. Re-applied whenever a record script
// rewrites the text (loading, saving), and left alone once formatted.
const STAMPS = "#classTag, #containmentTag, #tagView, .metaLine";

function stampify(node) {
    const text = node.textContent;
    const i = text.indexOf(":");
    if (i < 1 || node.querySelector(".stampKey")) return;
    const key = text.slice(0, i).trim();
    const value = text.slice(i + 1).trim();
    node.classList.add("stamp");
    node.dataset.key = key.toUpperCase();
    node.dataset.value = value.toUpperCase();
    node.replaceChildren(el("span", { class: "stampKey", text: key }), el("span", { class: "stampVal", text: value }));
}

function watchStamps() {
    const apply = () => document.querySelectorAll(STAMPS).forEach(stampify);
    apply();
    new MutationObserver(apply).observe(document.body, { childList: true, subtree: true, characterData: true });
}

// Forms on the console and access pages relied on placeholders, which vanish as you type. Give
// every field without a label a visible one, worded from its own placeholder (or id).
const FIELD_NAMES = {
    docId: "Record ID", artDocId: "Record ID", incDocId: "Record ID", perDocId: "Record ID",
    email: "Email", password: "Password", confirmPassword: "Confirm password",
    classification: "Classification", artClassification: "Classification",
    containment: "Containment", incSeverity: "Severity", incStatus: "Status",
    perStatus: "Status", perClearance: "Clearance"
};

function labelFields() {
    const fields = document.querySelectorAll("main input, main select, main textarea, .file input, .file select, .file textarea, #gateOverlay input");
    fields.forEach((f) => {
        if (!f.id || f.type === "hidden" || f.type === "color" || f.type === "file") return;
        if (f.closest("label") || document.querySelector(`label[for="${CSS.escape(f.id)}"]`)) return;
        const fromPlaceholder = (f.getAttribute("placeholder") || "").replace(/\s*\(e\.g\..*$/i, "").replace(/\.{3}$/, "").trim();
        const text = FIELD_NAMES[f.id] || (fromPlaceholder && !/^[?\s]*$/.test(fromPlaceholder) && !/@/.test(fromPlaceholder) ? fromPlaceholder : null);
        if (!text) return;
        const label = el("label", { for: f.id, class: "fieldLabel", text });
        f.before(label);
    });
}

function init() {
    const type = PAGE_TYPE[page] || "cpList";
    document.body.classList.add("cpOS", type);
    // The old corner links are replaced by the system bar.
    document.querySelectorAll(".adminLink, .recordsLink").forEach((a) => a.remove());
    const parts = buildBar();
    document.body.insertBefore(parts.bar, document.body.firstChild);
    watchAuth(parts);
    watchStamps();
    if (type === "cpConsole" || type === "cpAuth") labelFields();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
