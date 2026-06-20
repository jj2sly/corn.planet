// =========================================
// NAV AUTH LINKS
// Manages two corner links:
//   .recordsLink -> shown for CPI Correspondent and above, points to records.html
//   .adminLink   -> shown for CPI Exec only, points to admin.html (Super Admin Panel)
// Logged-out visitors / Viewer / CPI Employee see neither; instead a
// LOGIN / SIGN UP link appears in the .adminLink slot.
// Include on every page that has these elements.
// =========================================

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth, can, getUserRole, ensureUserDoc } from "./roles.js";

function setLink(el, { href, text, show }) {
    if (!el) return;
    el.setAttribute("href", href);
    el.textContent = text;
    el.style.display = show ? "inline-flex" : "none";
}

document.addEventListener("DOMContentLoaded", () => {
    const adminLink = document.querySelector(".adminLink");
    const recordsLink = document.querySelector(".recordsLink");

    // Default state before auth resolves: logged out.
    setLink(adminLink, { href: "login.html", text: "LOGIN / SIGN UP", show: true });
    setLink(recordsLink, { href: "records.html", text: "RECORDS DIVISION", show: false });

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            setLink(adminLink, { href: "login.html", text: "LOGIN / SIGN UP", show: true });
            setLink(recordsLink, { href: "records.html", text: "RECORDS DIVISION", show: false });
            return;
        }

        await ensureUserDoc(user);
        const role = await getUserRole(user.uid);

        const isExec = can.accessSuperAdminPanel(role);
        const isCorrespondentPlus = can.accessRecordsDivision(role);

        if (isExec) {
            setLink(adminLink, { href: "admin.html", text: "ADMIN", show: true });
        } else {
            setLink(adminLink, { href: "login.html", text: "LOGIN / SIGN UP", show: true });
        }

        setLink(recordsLink, { href: "records.html", text: "RECORDS DIVISION", show: isCorrespondentPlus });
    });
});
