const boot = document.querySelector("#boot");
const bootMessage = document.querySelector("#bootMessage");
const play = document.querySelector("#play");
const finish = document.querySelector("#finish");
const scoreEl = document.querySelector("#score");
const roundEl = document.querySelector("#round");
const streakEl = document.querySelector("#streak");
const kindEl = document.querySelector("#kind");
const subjectEl = document.querySelector("#subject");
const refEl = document.querySelector("#ref");
const optionEls = [...document.querySelectorAll(".option")];
const reveal = document.querySelector("#reveal");
const resultLabel = document.querySelector("#resultLabel");
const resultTitle = document.querySelector("#resultTitle");
const resultText = document.querySelector("#resultText");
const realSource = document.querySelector("#realSource");
const fakeSource = document.querySelector("#fakeSource");
const next = document.querySelector("#next");
const inspectRecord = document.querySelector("#inspectRecord");
const finalScore = document.querySelector("#finalScore");
const finalDetail = document.querySelector("#finalDetail");
const replay = document.querySelector("#replay");
const home = document.querySelector("#home");

const TOTAL_ROUNDS = 10;
const POINTS = 100;

let records = [];
let rounds = [];
let roundIndex = 0;
let score = 0;
let streak = 0;
let correctAnswers = 0;
let locked = false;

function scalar(value) {
  if (typeof value === "string") {
    const text = value.trim().replace(/\s+/g, " ");
    if (text.includes("[REDACTED]") || text.includes("[CLASSIFIED]") || text.includes("[COSMIC ERASED]")) return null;
    if (text.length >= 2 && text.length <= 120 && !/^https?:\/\//i.test(text)) return text;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
    const text = parts.slice(0, 4).join(", ");
    if (text.length >= 2 && text.length <= 120) return text;
  }
  return null;
}

function usableFields(record) {
  const fields = record?.fields && typeof record.fields === "object" ? record.fields : {};
  const out = new Map();
  for (const [key, value] of Object.entries(fields)) {
    const text = scalar(value);
    if (!text) continue;
    const lower = key.toLowerCase();
    if (lower.includes("image") || lower.includes("url") || lower.includes("created") || lower.includes("updated")) continue;
    out.set(key, text);
  }
  return out;
}

function titleCase(value) {
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Canon text nearly always names its own record ("Thad Phelps is…"), so a borrowed value is
// re-pointed at the round's record, or the fake would give itself away. Mirrors
// server/games/claims.ts. The result is generated, round-only content — never canon.
const ARTICLE = /^(?:the|a|an)\s+/i;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function plainName(title) {
  const plain = String(title || "").replace(/[“"][^”"]*[”"]/g, " ").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return plain.length >= 2 ? plain : String(title || "");
}

function nameVariants(title) {
  const variants = new Set();
  const add = (value) => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (clean.length >= 3) variants.add(clean);
  };
  const raw = String(title || "");
  const bare = plainName(raw);
  for (const form of [raw, raw.replace(/[“”"]/g, ""), bare]) {
    add(form);
    add(form.trim().replace(ARTICLE, ""));
  }
  const tokens = bare.trim().replace(ARTICLE, "").split(/\s+/);
  const words = tokens
    .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((word) => word.length >= 3 && /^\p{Lu}/u.test(word));
  if (tokens.length > 1 && words.length > 0) {
    add(words[0]);
    add(words[words.length - 1]);
  }
  return [...variants].sort((a, b) => b.length - a.length);
}

function namePattern(keys, flags = "u") {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${keys.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, flags);
}

function mentions(value, title) {
  const variants = nameVariants(title);
  return variants.length > 0 && namePattern(variants).test(value);
}

function borrowValue(value, donor, source) {
  const swaps = new Map();
  const sourceName = plainName(source.title);
  for (const variant of nameVariants(donor.title)) swaps.set(variant, sourceName);
  const designation = /^([A-Z]{2,4})-0*(\d+)$/.exec(String(donor.ref || ""));
  if (designation && /^[A-Z]{2,4}-\d+$/.test(String(source.ref || ""))) {
    swaps.set(donor.ref, source.ref);
    swaps.set(`${designation[1]}-${designation[2]}`, source.ref);
  }
  if (!swaps.size) return value;
  const keys = [...swaps.keys()].sort((a, b) => b.length - a.length);
  return value.replace(namePattern(keys, "gu"), (match) => swaps.get(match) ?? match);
}

const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function buildCandidates(allRecords) {
  const candidates = [];
  for (const source of shuffled(allRecords)) {
    const sourceFields = usableFields(source);
    if (!sourceFields.size) continue;

    for (const donor of shuffled(allRecords)) {
      if (donor === source || donor.kind !== source.kind) continue;
      const donorFields = usableFields(donor);
      const shared = [...sourceFields.keys()].filter((key) =>
        donorFields.has(key)
        && !sameText(donorFields.get(key), sourceFields.get(key))
        // A donor value that already names this record would read as being about someone else.
        && !mentions(donorFields.get(key), source.title));
      if (!shared.length) continue;

      const key = shared[Math.floor(Math.random() * shared.length)];
      const real = sourceFields.get(key);
      const fake = borrowValue(donorFields.get(key), donor, source);
      if (!real || !fake || sameText(real, fake)) continue;

      const options = shuffled([
        { text: `${titleCase(key)}: ${real}`, real: true },
        { text: `${titleCase(key)}: ${fake}`, real: false },
      ]);

      candidates.push({
        source,
        donor,
        key,
        options,
        correctIndex: options.findIndex((option) => option.real),
      });
      break;
    }
  }
  return candidates;
}

function renderRound() {
  if (roundIndex >= rounds.length) return showFinish();

  locked = false;
  reveal.classList.add("hidden");
  const current = rounds[roundIndex];

  roundEl.textContent = `ROUND ${roundIndex + 1} / ${rounds.length}`;
  streakEl.textContent = `STREAK ${streak}`;
  kindEl.textContent = String(current.source.kind || "CANON").toUpperCase();
  subjectEl.textContent = current.source.title || "UNTITLED CPI RECORD";
  // The record's id stays hidden until the answer: it would point straight at the source.
  refEl.textContent = "WHICH IS CPI CANON?";

  optionEls.forEach((button, index) => {
    button.disabled = false;
    button.classList.remove("correct", "wrong");
    button.querySelector(".claim").textContent = current.options[index].text;
  });
}

function choose(index) {
  if (locked || !rounds[roundIndex]) return;
  locked = true;

  const current = rounds[roundIndex];
  const correct = index === current.correctIndex;

  if (correct) {
    correctAnswers += 1;
    streak += 1;
    const gained = POINTS + Math.min(50, Math.max(0, streak - 1) * 10);
    score += gained;
    resultLabel.textContent = "CANON";
    resultTitle.textContent = "CORRECT";
    resultText.textContent = `+${gained}${streak > 1 ? ` · STREAK x${streak}` : ""}`;
  } else {
    streak = 0;
    resultLabel.textContent = "SHIT";
    resultTitle.textContent = "WRONG";
    resultText.textContent = "That claim was borrowed from another record. Streak reset.";
  }

  scoreEl.textContent = String(score);
  streakEl.textContent = `STREAK ${streak}`;

  optionEls.forEach((button, optionIndex) => {
    button.disabled = true;
    if (optionIndex === current.correctIndex) button.classList.add("correct");
    else if (optionIndex === index) button.classList.add("wrong");
  });

  realSource.textContent = `${current.source.ref || "CPI"} // ${current.source.title || "Untitled"}`;
  fakeSource.textContent = `${current.donor.ref || "CPI"} // ${current.donor.title || "Untitled"}`;
  reveal.classList.remove("hidden");
  next.focus();
}

function advance() {
  if (!locked) return;
  roundIndex += 1;
  renderRound();
}

function showFinish() {
  play.classList.add("hidden");
  finish.classList.remove("hidden");
  finalScore.textContent = String(score);
  const percent = rounds.length ? Math.round((correctAnswers / rounds.length) * 100) : 0;
  finalDetail.textContent = `${correctAnswers} of ${rounds.length} records called correctly — ${percent}% accuracy.`;
}

function start() {
  const candidates = buildCandidates(records);
  if (!candidates.length) {
    boot.classList.remove("hidden");
    play.classList.add("hidden");
    finish.classList.add("hidden");
    bootMessage.textContent = "The current CPI canon does not have enough comparable fields to build a round.";
    return;
  }

  rounds = shuffled(candidates).slice(0, Math.min(TOTAL_ROUNDS, candidates.length));
  roundIndex = 0;
  score = 0;
  streak = 0;
  correctAnswers = 0;
  scoreEl.textContent = "0";
  boot.classList.add("hidden");
  finish.classList.add("hidden");
  play.classList.remove("hidden");
  renderRound();
}

async function init() {
  const result = await window.cpiDesktop.fetchCanon();
  if (!result?.ok) {
    bootMessage.textContent = "Could not load CPI canon. Check the Party server from the Command Center.";
    return;
  }

  const incoming = result.data?.records;
  records = Array.isArray(incoming) ? incoming.filter((record) => record && typeof record === "object") : [];
  bootMessage.textContent = `${records.length} CPI records loaded.`;
  start();
}

optionEls.forEach((button, index) => button.addEventListener("click", () => choose(index)));
next.addEventListener("click", advance);
inspectRecord.addEventListener("click", async () => {
  const current = rounds[roundIndex];
  const url = current?.source?.url;
  if (!url) return;
  inspectRecord.disabled = true;
  try {
    await window.cpiDesktop.openCanonUrl(url);
  } finally {
    inspectRecord.disabled = false;
  }
});
replay.addEventListener("click", start);
home.addEventListener("click", () => window.cpiDesktop.navigate("home"));

window.addEventListener("keydown", (event) => {
  if (!finish.classList.contains("hidden")) return;
  if (!locked && (event.key === "1" || event.key === "2")) {
    choose(Number(event.key) - 1);
    return;
  }
  if (locked && event.key === "Enter") advance();
});

void init();
