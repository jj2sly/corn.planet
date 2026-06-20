// =========================================
// CPI ROLES MODULE
// Shared Firebase init + role helpers used across the site.
// =========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export const firebaseConfig = {
    apiKey: "AIzaSyBshT0wE2kjCIPpt1BozZvLlY3kGwWEH90",
    authDomain: "cpo-9af17.firebaseapp.com",
    projectId: "cpo-9af17",
    storageBucket: "cpo-9af17.firebasestorage.app",
    messagingSenderId: "526427336111",
    appId: "1:526427336111:web:8b71369117416ae937d35a"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// =========================================
// ROLE DEFINITIONS
// Ordered lowest -> highest. The numeric "level" is what
// every permission check compares against.
// =========================================
export const ROLES = {
    VIEWER:        { id: "VIEWER",        label: "Viewer",                  level: 0 },
    CPI_EMPLOYEE:  { id: "CPI_EMPLOYEE",  label: "CPI Employee (Trusted)",  level: 1 },
    CORRESPONDENT: { id: "CORRESPONDENT", label: "CPI Correspondent",       level: 2 },
    OVERSEER:      { id: "OVERSEER",      label: "Strike Team Overseer",    level: 3 },
    EXEC:          { id: "EXEC",          label: "CPI Exec",                level: 4 }
};

export const ROLE_LIST = Object.values(ROLES).sort((a, b) => a.level - b.level);

function levelOf(roleId) {
    const r = Object.values(ROLES).find(r => r.id === roleId);
    return r ? r.level : 0;
}

// Permission checks, built on role level so future roles slot in cleanly.
export const can = {
    revealRedactions: (roleId) => levelOf(roleId) >= ROLES.CPI_EMPLOYEE.level,
    editCreateContent: (roleId) => levelOf(roleId) >= ROLES.CORRESPONDENT.level,
    manageClassifications: (roleId) => levelOf(roleId) >= ROLES.OVERSEER.level,
    accessRecordsDivision: (roleId) => levelOf(roleId) >= ROLES.CORRESPONDENT.level,
    accessSuperAdminPanel: (roleId) => roleId === ROLES.EXEC.id
};

// =========================================
// USER DOC HELPERS
// Roles live in Firestore at users/{uid}, NOT in auth custom
// claims (no Cloud Functions / Blaze plan available for this project).
// Firestore security rules are what actually enforce this server-side
// — see firestore.rules. Client-side checks here are for UI only.
// =========================================

// Ensures a users/{uid} doc exists. Called right after signup or first
// login. New users always land as VIEWER until promoted by a CPI Exec.
export async function ensureUserDoc(user) {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
        await setDoc(ref, {
            email: user.email,
            role: ROLES.VIEWER.id,
            createdAt: new Date().toISOString()
        });
        return ROLES.VIEWER.id;
    }
    return snap.data().role || ROLES.VIEWER.id;
}

// Fetches the current role for a uid. Returns VIEWER if no doc exists
// (fail-closed: unknown users get the lowest permission level).
export async function getUserRole(uid) {
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) return ROLES.VIEWER.id;
        return snap.data().role || ROLES.VIEWER.id;
    } catch (err) {
        console.warn("Could not fetch role, defaulting to VIEWER:", err);
        return ROLES.VIEWER.id;
    }
}
