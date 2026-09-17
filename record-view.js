// =========================================
// CPI RECORD VIEWER
// Shared detail-page logic for CPI Database record types.
//
// entry.html (entities) and artifact-entry.html (artifacts) predate this module and still carry
// their own copies. New record types (incidents, personnel) are driven from here instead: a page
// supplies a field spec, this module renders, edits, logs and deletes it.
// =========================================

import {
    doc,
    getDoc,
    getDocs,
    collection,
    updateDoc,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { db, auth, can, getUserRole, ensureUserDoc } from "./roles.js";

const CLOUDINARY_CLOUD_NAME = "dzeymqtsv";
const CLOUDINARY_UPLOAD_PRESET = "cornplanetcloud";

async function uploadImageToCloudinary(file) {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const response = await fetch(url, { method: "POST", body: formData });
    if (!response.ok) {
        throw new Error("Image upload failed. Check your Cloudinary preset settings.");
    }
    const data = await response.json();
    return data.secure_url;
}

// =========================================
// TEXT RENDERING
// Record bodies use the CPI redaction markers, so they are rendered as HTML. The raw text is
// escaped first and only the redaction spans are added afterwards, so record text can never
// inject markup of its own.
// =========================================

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function applyRedactions(text) {
    return escapeHtml(text)
        .replace(/\/r!!(.*?)\/r!!/g, '<span class="redacted-cosmic">████ COSMIC ERASED ████</span>')
        .replace(/\/r!(.*?)\/r!/g, '<span class="redacted-heavy">██ CLASSIFIED ██</span>')
        .replace(/\/r(.*?)\/r/g, '<span class="redacted-normal">███ REDACTED ███</span>');
}

function formatAsParagraphs(text) {
    if (typeof text !== "string" || text.trim() === "") return "";

    let chunks = text.split(/\n\s*\n/);
    if (chunks.length === 1) chunks = text.split(/\n/);

    return chunks
        .map(chunk => chunk.trim())
        .filter(chunk => chunk.length > 0)
        .map(chunk => "<p>" + applyRedactions(chunk) + "</p>")
        .join("");
}

// =========================================
// MAIN
// spec = {
//   collection, label, listHref,
//   tag:    { key, label, options: [...] }                 // the coloured header tag
//   meta:   [{ key, label, options: [...] }]               // short select fields
//   fields: [{ key, label }]                               // long-form textareas
//   refs:   [{ key, label, collection, href, titleField }] // cross-references to other records
// }
// =========================================

export function initRecordView(spec) {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

    let currentRole = null;
    let currentData = null;
    let isEditMode = false;
    let redactionsRevealed = false;
    const refOptions = {};

    const $ = (elId) => document.getElementById(elId);
    const status = $("status");

    const metaFields = spec.meta || [];
    const refFields = spec.refs || [];
    const tagField = spec.tag;

    // ---------------------------------------------------------------- build the page

    function buildSkeleton() {
        const body = $("recordBody");

        for (const field of spec.fields) {
            const heading = document.createElement("h2");
            heading.textContent = field.label;

            const view = document.createElement("div");
            view.id = field.key + "View";
            view.className = "entryText";
            view.innerHTML = '<p class="loadingText">DECRYPTING...</p>';

            const edit = document.createElement("textarea");
            edit.id = field.key + "Edit";
            edit.className = "entryText";
            edit.style.display = "none";

            body.appendChild(heading);
            body.appendChild(view);
            body.appendChild(edit);
        }

        for (const ref of refFields) {
            const heading = document.createElement("h2");
            heading.textContent = ref.label;

            const view = document.createElement("div");
            view.id = ref.key + "View";
            view.className = "entryText";

            const edit = document.createElement("select");
            edit.id = ref.key + "Edit";
            edit.multiple = true;
            edit.size = 6;
            edit.style.display = "none";

            body.appendChild(heading);
            body.appendChild(view);
            body.appendChild(edit);
        }

        const logHeading = document.createElement("h2");
        logHeading.textContent = "ACTIVITY LOG";
        const logDiv = document.createElement("div");
        logDiv.id = "activityLog";
        logDiv.innerHTML = '<p class="loadingText">LOADING LOG...</p>';
        body.appendChild(logHeading);
        body.appendChild(logDiv);
    }

    function buildHeaderControls() {
        const header = $("metaHeader");

        const allSelects = [tagField].concat(metaFields);
        for (const field of allSelects) {
            if (field !== tagField) {
                const line = document.createElement("p");
                line.id = field.key + "View";
                line.className = "metaLine";
                header.appendChild(line);
            }

            const select = document.createElement("select");
            select.id = field.key + "Edit";
            select.style.display = "none";
            for (const option of field.options) {
                const opt = document.createElement("option");
                opt.value = option;
                opt.textContent = option;
                select.appendChild(opt);
            }
            header.appendChild(select);
        }
    }

    // ---------------------------------------------------------------- cross-references

    async function loadRefOptions() {
        for (const ref of refFields) {
            const options = [];
            try {
                const snapshot = await getDocs(collection(db, ref.collection));
                snapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    options.push({ id: docSnap.id, title: data[ref.titleField || "title"] || docSnap.id });
                });
            } catch (err) {
                console.warn("Could not load " + ref.collection + " for references:", err);
            }
            options.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
            refOptions[ref.key] = options;

            const select = $(ref.key + "Edit");
            select.innerHTML = "";
            for (const option of options) {
                const opt = document.createElement("option");
                opt.value = option.id;
                opt.textContent = option.id + " — " + option.title;
                select.appendChild(opt);
            }
        }
    }

    function renderRefs(ref, values) {
        const view = $(ref.key + "View");
        view.innerHTML = "";

        if (!Array.isArray(values) || values.length === 0) {
            const none = document.createElement("p");
            none.textContent = "None on record.";
            view.appendChild(none);
            return;
        }

        const known = new Map((refOptions[ref.key] || []).map((o) => [o.id, o.title]));
        for (const value of values) {
            const line = document.createElement("div");
            line.className = "entry";

            const link = document.createElement("a");
            link.href = ref.href + "?id=" + encodeURIComponent(value);
            link.textContent = known.has(value) ? value + " — " + known.get(value) : value;

            line.appendChild(link);
            view.appendChild(line);
        }
    }

    function selectedRefs(ref) {
        return Array.from($(ref.key + "Edit").selectedOptions).map((o) => o.value);
    }

    // ---------------------------------------------------------------- activity log

    function renderLog(logs) {
        const logDiv = $("activityLog");
        logDiv.innerHTML = "";

        if (!logs || logs.length === 0) {
            logDiv.textContent = "No activity recorded.";
            return;
        }

        logs.slice().reverse().forEach((log) => {
            const entry = document.createElement("div");
            entry.className = "logEntry";

            const date = document.createElement("strong");
            date.textContent = log.date || "Unknown date";

            entry.appendChild(date);
            entry.appendChild(document.createElement("br"));
            entry.appendChild(document.createTextNode(log.message || "No message"));
            logDiv.appendChild(entry);
        });
    }

    // ---------------------------------------------------------------- image

    function renderImage(url) {
        const imageView = $("imageView");
        imageView.innerHTML = "";
        if (!url) return;
        const img = document.createElement("img");
        img.src = url;
        img.className = "entityImage";
        img.alt = spec.label + " image";
        imageView.appendChild(img);
    }

    // ---------------------------------------------------------------- load

    async function loadRecord() {
        if (!id) {
            $("title").textContent = "NO " + spec.label + " ID PROVIDED";
            return;
        }

        const snapshot = await getDoc(doc(db, spec.collection, id));
        if (!snapshot.exists()) {
            $("title").textContent = spec.label + " NOT FOUND";
            return;
        }

        currentData = snapshot.data();

        $("number").textContent = id;
        $("title").textContent = currentData.title || "UNTITLED " + spec.label;
        $("titleEdit").value = currentData.title || "";

        const tagValue = (currentData[tagField.key] || "UNKNOWN").toString().toUpperCase();
        $("tagView").textContent = tagField.label + ": " + tagValue;
        $(tagField.key + "Edit").value = tagValue;

        renderImage(currentData.imageURL);

        for (const field of metaFields) {
            const value = (currentData[field.key] || "").toString();
            $(field.key + "View").textContent = field.label + ": " + (value || "UNKNOWN");
            $(field.key + "Edit").value = value.toUpperCase();
        }

        for (const field of spec.fields) {
            $(field.key + "View").innerHTML = formatAsParagraphs(currentData[field.key] || "");
            $(field.key + "Edit").value = currentData[field.key] || "";
        }

        await loadRefOptions();
        for (const ref of refFields) {
            const values = Array.isArray(currentData[ref.key]) ? currentData[ref.key] : [];
            renderRefs(ref, values);
            const select = $(ref.key + "Edit");
            for (const option of select.options) option.selected = values.includes(option.value);
        }

        renderLog(currentData.logs || []);
    }

    // ---------------------------------------------------------------- edit mode

    function toggleMode() {
        isEditMode = !isEditMode;
        const show = (el, on, display) => { if (el) el.style.display = on ? (display || "block") : "none"; };

        for (const field of spec.fields) {
            show($(field.key + "View"), !isEditMode);
            show($(field.key + "Edit"), isEditMode);
        }
        for (const ref of refFields) {
            show($(ref.key + "View"), !isEditMode);
            show($(ref.key + "Edit"), isEditMode);
        }
        for (const field of metaFields) {
            show($(field.key + "View"), !isEditMode);
            show($(field.key + "Edit"), isEditMode, "inline-block");
        }

        show($("title"), !isEditMode);
        show($("titleEdit"), isEditMode, "inline-block");
        show($("imageEdit"), isEditMode);
        show($("tagView"), !isEditMode);
        show($(tagField.key + "Edit"), isEditMode, "inline-block");

        $("editBtn").textContent = isEditMode ? "SAVE CHANGES" : "EDIT FILE";
    }

    async function save() {
        const logs = Array.isArray(currentData.logs) ? currentData.logs.slice() : [];
        const priorLogCount = logs.length;
        const addLog = (message) => logs.push({ date: new Date().toLocaleString(), message });

        const updated = { title: $("titleEdit").value };
        if ((currentData.title || "") !== updated.title) addLog("Title changed.");

        for (const field of [tagField].concat(metaFields)) {
            updated[field.key] = $(field.key + "Edit").value;
            if ((currentData[field.key] || "") !== updated[field.key]) {
                addLog(field.label + " changed to " + updated[field.key] + ".");
            }
        }

        for (const field of spec.fields) {
            updated[field.key] = $(field.key + "Edit").value;
            if ((currentData[field.key] || "") !== updated[field.key]) addLog(field.label + " modified.");
        }

        for (const ref of refFields) {
            updated[ref.key] = selectedRefs(ref);
            const before = Array.isArray(currentData[ref.key]) ? currentData[ref.key] : [];
            if (before.join(",") !== updated[ref.key].join(",")) addLog(ref.label + " updated.");
        }

        updated.imageURL = currentData.imageURL || "";
        const imageFile = $("imageEdit").files[0];
        if (imageFile) {
            status.textContent = "Uploading image...";
            try {
                updated.imageURL = await uploadImageToCloudinary(imageFile);
            } catch (err) {
                console.error(err);
                status.textContent = "Image upload failed. Other changes were not saved.";
                return false;
            }
            addLog("Image updated.");
        }

        if (logs.length === priorLogCount) addLog("File reviewed, no changes made.");
        updated.logs = logs;

        await updateDoc(doc(db, spec.collection, id), updated);
        currentData = Object.assign({}, currentData, updated);

        renderImage(updated.imageURL);
        $("imageEdit").value = "";

        $("title").textContent = updated.title || "UNTITLED " + spec.label;
        $("tagView").textContent = tagField.label + ": " + (updated[tagField.key] || "UNKNOWN").toUpperCase();
        for (const field of metaFields) {
            $(field.key + "View").textContent = field.label + ": " + (updated[field.key] || "UNKNOWN");
        }
        for (const field of spec.fields) {
            $(field.key + "View").innerHTML = formatAsParagraphs(updated[field.key] || "");
        }
        for (const ref of refFields) renderRefs(ref, updated[ref.key]);
        renderLog(logs);

        status.textContent = "Changes saved successfully.";
        return true;
    }

    // ---------------------------------------------------------------- wiring

    onAuthStateChanged(auth, async (user) => {
        const editBtn = $("editBtn");
        const deleteBtn = $("deleteBtn");
        const revealBtn = $("revealBtn");

        if (!user) {
            currentRole = null;
            editBtn.style.display = "none";
            deleteBtn.style.display = "none";
            revealBtn.style.display = "none";
            return;
        }

        await ensureUserDoc(user);
        currentRole = await getUserRole(user.uid);

        // Edit/Delete require CPI Correspondent or above.
        if (can.editCreateContent(currentRole)) {
            editBtn.style.display = "inline-block";
            deleteBtn.style.display = "inline-block";
        } else {
            status.textContent = "VIEW-ONLY ACCESS — INSUFFICIENT CLEARANCE TO EDIT";
        }

        // Reveal Redactions requires CPI Employee (Trusted) or above.
        if (can.revealRedactions(currentRole)) {
            revealBtn.style.display = "inline-block";
        }
    });

    $("editBtn").addEventListener("click", async () => {
        if (!can.editCreateContent(currentRole)) {
            status.textContent = "Insufficient clearance to edit.";
            return;
        }
        if (!isEditMode) {
            toggleMode();
            return;
        }
        if (await save()) toggleMode();
    });

    $("deleteBtn").addEventListener("click", async () => {
        if (!can.editCreateContent(currentRole)) {
            status.textContent = "Insufficient clearance to delete.";
            return;
        }
        if (!confirm("TERMINATION PROTOCOL\n\nDelete this " + spec.label.toLowerCase() + " permanently?")) return;

        await deleteDoc(doc(db, spec.collection, id));
        window.location.href = spec.listHref;
    });

    $("revealBtn").addEventListener("click", () => {
        if (!can.revealRedactions(currentRole) || !currentData) return;

        redactionsRevealed = !redactionsRevealed;
        for (const field of spec.fields) {
            const view = $(field.key + "View");
            if (redactionsRevealed) {
                view.textContent = currentData[field.key] || "";
            } else {
                view.innerHTML = formatAsParagraphs(currentData[field.key] || "");
            }
        }
        $("revealBtn").textContent = redactionsRevealed ? "HIDE REDACTIONS" : "REVEAL REDACTIONS";
    });

    buildSkeleton();
    buildHeaderControls();
    loadRecord().catch((err) => {
        console.error(err);
        $("title").textContent = "COULD NOT REACH THE DATABASE";
    });
}
