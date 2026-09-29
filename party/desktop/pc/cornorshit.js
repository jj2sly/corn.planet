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

function buildCandidates(allRecords) {
  const candidates = [];
  for (const source of shuffled(allRecords)) {
    const sourceFields = usableFields(source);
    if (!sourceFields.size) continue;

    for (const donor of shuffled(allRecords)) {
      if (donor === source || donor.kind !== source.kind) continue;
      const donorFields = usableFields(donor);
      const shared = [...sourceFields.keys()].filter((key) => donorFields.has(key) && donorFields.get(key) !== sourceFields.get(key));
      if (!shared.length) continue;

      const key = shared[Math.floor(Math.random() * shared.length)];
      const real = sourceFields.get(key);
      const fake = donorFields.get(key);
      if (!real || !fake) continue;

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
  refEl.textContent = current.source.ref || "CPI RECORD";

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
    score += POINTS + Math.min(50, Math.max(0, streak - 1) * 10);
    resultLabel.textContent = "DOCUMENTED";
    resultTitle.textContent = "CORRECT";
    resultText.textContent = streak > 1 ? `Streak x${streak}. The record backs that claim.` : "The record backs that claim.";
  } else {
    streak = 0;
    resultLabel.textContent = "FABRICATION";
    resultTitle.textContent = "WRONG";
    resultText.textContent = "That value belongs to a different CPI record.";
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
