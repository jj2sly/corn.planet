// Login for Corn Planet Party. In production this is the CPI Database's Firebase login: the same
// email and password. Tokens are verified by the Corn Planet Party server, never trusted as-is.

import { loadConfig, store } from "./common.js";

const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.12.0";
const DEV_TOKEN_KEY = "cpst-party:dev-token";

let ready = null;
let mode = "none";
let firebaseAuth = null;
let firebaseDb = null;
let fb = null;
let fs = null;
const listeners = new Set();

function emit() {
  const user = currentUser();
  for (const fn of listeners) fn(user);
}

/** Resolves once the login state is known. */
export function initAuth() {
  ready ??= (async () => {
    const config = await loadConfig();
    mode = config.auth.mode;
    if (mode === "firebase" && config.auth.firebase) {
      const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
        import(`${FIREBASE_SDK}/firebase-app.js`),
        import(`${FIREBASE_SDK}/firebase-auth.js`),
        import(`${FIREBASE_SDK}/firebase-firestore.js`),
      ]);
      fb = authModule;
      fs = firestoreModule;
      const app = initializeApp(config.auth.firebase, "cpst-party");
      firebaseAuth = fb.getAuth(app);
      firebaseDb = fs.getFirestore(app);
      await fb.setPersistence(firebaseAuth, fb.browserLocalPersistence);
      await new Promise((resolve) => {
        const stop = fb.onAuthStateChanged(firebaseAuth, () => {
          stop();
          resolve();
        });
      });
      fb.onAuthStateChanged(firebaseAuth, emit);
    }
    return mode;
  })();
  return ready;
}

export function authMode() {
  return mode;
}

/** { label } for the signed-in account, or null. */
export function currentUser() {
  if (mode === "firebase") return firebaseAuth?.currentUser ? { label: firebaseAuth.currentUser.email } : null;
  if (mode === "dev") {
    const token = store.get("localStorage", DEV_TOKEN_KEY);
    return token ? { label: token.split(":").slice(1).join(" · ") } : null;
  }
  return null;
}

export async function getToken() {
  await initAuth();
  if (mode === "firebase") return firebaseAuth?.currentUser ? firebaseAuth.currentUser.getIdToken() : null;
  if (mode === "dev") return store.get("localStorage", DEV_TOKEN_KEY);
  return null;
}

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const FIREBASE_ERRORS = {
  "auth/invalid-credential": "That email and password don't match any CPI personnel record.",
  "auth/invalid-email": "That doesn't look like an email address.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/email-already-in-use": "An account with that email already exists. Log in instead.",
  "auth/weak-password": "Passwords must be at least 6 characters.",
  "auth/network-request-failed": "Network error. Check your connection.",
};

function friendly(err) {
  return new Error(FIREBASE_ERRORS[err?.code] ?? "Login failed. Try again.");
}

/**
 * Keep Corn Planet Party accounts synchronized with the CPI Database role system.
 * The CPI website reads personnel from Firestore users/{uid}; Firebase Auth alone
 * is not enough for an account to appear in the Super Admin Panel.
 */
async function ensureCpiUserDoc(user) {
  if (!user?.uid || !firebaseDb || !fs) throw new Error("CPI account sync unavailable.");

  const ref = fs.doc(firebaseDb, "users", user.uid);
  const snap = await fs.getDoc(ref);
  if (snap.exists()) return snap.data()?.role ?? "VIEWER";

  await fs.setDoc(ref, {
    email: user.email || "",
    role: "VIEWER",
    createdAt: new Date().toISOString(),
  });

  const verified = await fs.getDoc(ref);
  if (!verified.exists()) throw new Error("CPI account record was not created.");
  return verified.data()?.role ?? "VIEWER";
}

export async function signIn(email, password) {
  await initAuth();
  try {
    const result = await fb.signInWithEmailAndPassword(firebaseAuth, email, password);
    await ensureCpiUserDoc(result.user);
  } catch (err) {
    if (err?.code) throw friendly(err);
    throw new Error(err?.message ?? "CPI account sync failed. Try again.");
  }
}

export async function register(email, password) {
  await initAuth();
  try {
    const result = await fb.createUserWithEmailAndPassword(firebaseAuth, email, password);
    await ensureCpiUserDoc(result.user);
  } catch (err) {
    if (err?.code) throw friendly(err);
    throw new Error(err?.message ?? "Account created, but CPI database sync failed. Log in again to retry.");
  }
}

/** Local testing only: the server refuses dev logins in production. */
export function devSignIn(uid, role) {
  store.set("localStorage", DEV_TOKEN_KEY, `dev:${uid}:${role}`);
  emit();
}

export async function signOut() {
  await initAuth();
  if (mode === "firebase") await fb.signOut(firebaseAuth);
  if (mode === "dev") {
    store.remove("localStorage", DEV_TOKEN_KEY);
    emit();
  }
}
