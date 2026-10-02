// The host screen's ambient background layer (public/js/host-ambient.js): which theme each game
// gets, that there is only ever one layer and it is replaced when the game changes, that it follows
// reduced motion, stays small and static to build, and never reaches the phone/controller pages.
// The module needs a DOM; a tiny stand-in is enough for what it uses.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ambientMood, ambientTheme, createAmbient } from "../public/js/host-ambient.js";

class FakeNode {
  tag: string;
  attrs = new Map<string, string>();
  vars = new Map<string, string>();
  dataset: Record<string, string> = {};
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  text = "";
  style = { setProperty: (key: string, value: string) => this.vars.set(key, value) };
  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attrs.set(key, String(value));
  }
  append(...items: (FakeNode | string)[]) {
    for (const item of items) {
      if (typeof item === "string") this.text += item;
      else {
        item.parent = this;
        this.children.push(item);
      }
    }
  }
  prepend(item: FakeNode) {
    item.parent = this;
    this.children.unshift(item);
  }
  remove() {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  get isConnected() {
    return this.parent !== null;
  }
  hasClass(name: string) {
    return (this.attrs.get("class") ?? "").split(/\s+/).includes(name);
  }
  // Only the selector the module uses.
  querySelectorAll(selector: string) {
    assert.equal(selector, ":scope > .host-ambient");
    return this.children.filter((c) => c.hasClass("host-ambient"));
  }
  all(): FakeNode[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
  outline(): string {
    return `${this.tag}.${this.attrs.get("class") ?? ""}[${[...this.vars].join(",")}]{${this.text}}(${this.children.map((c) => c.outline()).join("")})`;
  }
}

const GAMES = ["chaos", "entityauction", "budgetcuts", "channelcob", "mycob", "cornorshit", "steamdeck", "thud"];

function mediaStub(initial = false) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  return { query, listeners, set: (matches: boolean) => ((query.matches = matches), listeners.forEach((fn) => fn())), matchMedia: () => query };
}

const body = () => new FakeNode("body");
const make = (parent: FakeNode, media = mediaStub()) => createAmbient(parent, { matchMedia: media.matchMedia });
const roots = (parent: FakeNode) => parent.children.filter((c) => c.hasClass("host-ambient"));

describe("host ambient", () => {
  const original = { document: (globalThis as { document?: unknown }).document };
  beforeEach(() => {
    (globalThis as { document?: unknown }).document = {
      createElement: (tag: string) => new FakeNode(tag),
      createElementNS: (_: string, tag: string) => new FakeNode(tag),
    };
  });
  afterEach(() => {
    (globalThis as { document?: unknown }).document = original.document;
  });

  it("picks a theme for every game, and none for the lobby, results or unknown games", () => {
    const themes = GAMES.map((id) => ambientTheme(id));
    assert.ok(themes.every((t) => typeof t === "string" && t.length > 0), "every game has a theme");
    assert.equal(new Set(themes).size, GAMES.length, "each game's theme is its own");
    assert.equal(ambientTheme("chaos"), "incident");
    for (const none of [null, undefined, "", "lobby", "toString", "__proto__", 7]) assert.equal(ambientTheme(none as never), null);
  });

  it("covers every game the host can render", () => {
    const host = readFileSync(new URL("../public/js/host.js", import.meta.url), "utf8");
    const rendered = /const RENDERERS = \{([^}]*)\}/.exec(host)![1]!.split(",").map((s) => s.trim()).filter(Boolean);
    assert.deepEqual([...rendered].sort(), [...GAMES].sort());
  });

  it("puts up one hidden, non-interactive layer with the game's theme", () => {
    const page = body();
    const ambient = make(page);
    ambient.show("chaos", "VOTING");
    const [root, ...extra] = roots(page);
    assert.equal(extra.length, 0);
    assert.equal(root!.dataset.theme, "incident");
    assert.equal(root!.dataset.game, "chaos");
    assert.equal(root!.attrs.get("aria-hidden"), "true");
    assert.ok(root!.children.length >= 5, "several layers");
    assert.ok(root!.all().every((n) => n.tag !== "canvas" && n.tag !== "script" && n.tag !== "a" && n.tag !== "button"), "decorative elements only");
    assert.ok(root!.children.at(-1)!.hasClass("amb-vignette"), "the quiet centre sits over every layer");
  });

  it("swaps the layer when the game changes and removes it when there is no game", () => {
    const page = body();
    const ambient = make(page);
    ambient.show("chaos", "INTRO");
    const first = ambient.root;
    ambient.show("entityauction", "BIDDING");
    assert.equal(roots(page).length, 1, "never two layers");
    assert.notEqual(ambient.root, first);
    assert.equal(first!.isConnected, false, "the old layer is gone");
    assert.equal(ambient.root!.dataset.theme, "bay");
    ambient.show(null);
    assert.equal(roots(page).length, 0);
    assert.equal(ambient.root, null);
    ambient.show("thud", "SELECT");
    ambient.hide();
    assert.equal(roots(page).length, 0);
  });

  it("does not rebuild or duplicate the layer when the same game re-renders", () => {
    const page = body();
    const ambient = make(page);
    ambient.show("chaos", "ANSWERING");
    const root = ambient.root;
    const nodes = root!.all().length;
    for (const phase of ["ANSWERING", "VOTING", "VERDICT", "STANDINGS", "ANSWERING"]) ambient.show("chaos", phase);
    assert.equal(ambient.root, root, "the same element throughout");
    assert.equal(roots(page).length, 1);
    assert.equal(root!.all().length, nodes);
    assert.equal(root!.dataset.mood, "quiet");
  });

  it("clears out a stale layer left by an earlier instance", () => {
    const page = body();
    make(page).show("chaos", "INTRO");
    const second = make(page);
    second.show("chaos", "INTRO");
    assert.equal(roots(page).length, 1);
    second.destroy();
    assert.equal(roots(page).length, 0);
  });

  it("follows the room's broad mood only", () => {
    assert.equal(ambientMood("chaos", "VOTING"), "quiet");
    assert.equal(ambientMood("chaos", "STANDINGS"), "active");
    assert.equal(ambientMood("mycob", "ALERT"), "alert");
    assert.equal(ambientMood("mycob", "RESPONSE"), "quiet");
    assert.equal(ambientMood("chaos", "NO_SUCH_PHASE"), "quiet");
    assert.equal(ambientMood("lobby", "ALERT"), "quiet");
    const page = body();
    const ambient = make(page);
    ambient.show("mycob", "RESPONSE");
    assert.equal(ambient.root!.dataset.mood, "quiet");
    ambient.show("mycob", "ALERT");
    assert.equal(ambient.root!.dataset.mood, "alert");
  });

  it("keeps its look but stands still with reduced motion, live", () => {
    const media = mediaStub(true);
    const page = body();
    const ambient = make(page, media);
    ambient.show("chaos", "VOTING");
    assert.equal(ambient.motion, "still");
    assert.equal(ambient.root!.dataset.motion, "still");
    assert.ok(ambient.root!.children.length >= 5, "the themed layers are still there");
    media.set(false);
    assert.equal(ambient.root!.dataset.motion, "drift");
    media.set(true);
    assert.equal(ambient.root!.dataset.motion, "still");
    // A layer built after the preference changes starts in the right state.
    ambient.show("thud", "SELECT");
    assert.equal(ambient.root!.dataset.motion, "still");
    ambient.destroy();
    assert.equal(media.listeners.size, 0, "no listener left behind");
  });

  it("moves by default", () => {
    const ambient = make(body());
    assert.equal(ambient.motion, "drift");
  });

  it("builds small, identical layers: a few dozen nodes, no randomness", () => {
    for (const id of GAMES) {
      const a = make(body());
      a.show(id, "X");
      const b = make(body());
      b.show(id, "X");
      assert.equal(a.root!.outline(), b.root!.outline(), `${id} lays out the same every time`);
      assert.ok(a.root!.all().length <= 160, `${id}: ${a.root!.all().length} nodes`);
    }
  });
});

describe("the ambient layer stays on the host screen", () => {
  const publicDir = new URL("../public/", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, publicDir), "utf8");

  it("is only wired up by the host page, and only while a game is running", () => {
    const host = read("js/host.js");
    assert.match(host, /import \{ createAmbient \} from "\.\/host-ambient\.js"/);
    assert.match(host, /ambient\.show\(state\.status === "IN_GAME" \? state\.config\.gameId : null/);
    assert.match(host, /ambient\.hide\(\)/, "gone when the session closes");
  });

  it("is never loaded by a phone/controller page or script", () => {
    const phoneFiles = [...readdirSync(new URL("js/", publicDir)), ...readdirSync(new URL("js/games/", publicDir)).map((f) => `games/${f}`)].filter((f) => /^(play\.js|games\/.*-play\.js)$/.test(f));
    assert.ok(phoneFiles.length >= 8, "found the phone scripts");
    for (const file of phoneFiles) assert.doesNotMatch(read(`js/${file}`), /host-ambient/, file);
    for (const page of ["play.html", "index.html"]) assert.doesNotMatch(read(page), /host-ambient/, page);
    assert.doesNotMatch(read("host.html"), /host-ambient/, "host.js loads it, not a separate tag");
  });

  it("is styled to sit behind everything and ignore input", () => {
    const css = read("css/party.css");
    const rule = /\.host-ambient \{([^}]*)\}/.exec(css)![1]!;
    assert.match(rule, /pointer-events: none/);
    assert.match(rule, /z-index: -1/);
    assert.match(rule, /position: fixed/);
    assert.match(css, /\.host-ambient\[data-motion="still"\][^{]*\{[^}]*animation: none !important/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.host-ambient[\s\S]*animation: none !important/);
    // Only compositor-friendly motion: no filters or blurs anywhere in the ambient section.
    const section = css.slice(css.indexOf("Host ambient backgrounds"));
    assert.doesNotMatch(section, /filter:|backdrop-filter|blur\(/);
  });
});
