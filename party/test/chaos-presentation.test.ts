// Cornlashing's show presentation (host matchup/reveal, phone write/pick/wait). The game rules are
// tested in chaos.test.ts; these check the screens still drive the same server actions, keep the
// reveal staged after the vote, mark ties and the final round, and respect reduced motion.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8");

describe("Cornlashing presentation", () => {
  const phone = read("js/games/chaos-play.js");
  const host = read("js/games/chaos-host.js");
  const css = read("css/party.css");

  it("the phone still sends only answer and vote, with the same payloads", () => {
    const actions = new Set([...phone.matchAll(/action: "([a-z]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...actions].sort(), ["answer", "vote"]);
    assert.match(phone, /payload: \{ incidentId: assignment\.incidentId, text: textarea\.value \}/);
    assert.match(phone, /payload: \{ incidentId: g\.incidentId, reportId: r\.id \}/);
  });

  it("the phone keeps the own-answer rule and each phase has one short purpose", () => {
    assert.match(phone, /disabled: own/, "you can't vote for yourself");
    assert.match(phone, /"WRITE/);
    assert.match(phone, /PICK ·/);
    assert.match(phone, /"WAIT"/);
    assert.match(phone, /canVote/);
  });

  it("the host reveal is staged and flags ties, defaults and the final round", () => {
    assert.match(host, /lash-stage reveal/);
    assert.match(host, /tie \? "tie" : ""/);
    assert.match(host, /verdict\.defaulted \? "default"/);
    assert.match(host, /g\.breach \? "final"/);
    // The winning sting is a single, moderated cue, and never plays for a vote with no votes.
    assert.equal([...host.matchAll(/playSfx\("cob_sting"/g)].length, 3, "one in the reveal, two for the cob crown (live and reduced motion)");
    assert.match(host, /verdict\.totalVotes > 0 && !reducedMotion\(\)/);
  });

  it("authors stay out of the voting screen and appear only in the verdict", () => {
    const voting = host.slice(host.indexOf("function buildVoting"), host.indexOf("/** Set through the CSSOM"));
    assert.doesNotMatch(voting, /authorName|authorId/);
    const verdict = host.slice(host.indexOf("function buildVerdict"), host.indexOf("- the cob scoreboard"));
    assert.match(verdict, /authorName/);
  });

  it("the reveal order is votes, then the hit, then authors, then points", () => {
    const delay = (selector: string) => Number(new RegExp(`${selector}[^{]*\\{[^}]*animation: [a-z-]+ [0-9.]+s ([0-9.]+)s`).exec(css)?.[1]);
    const bars = delay("\\.lash-stage\\.reveal \\.lash-bar span");
    const hit = delay("\\.lash-stage\\.reveal \\.lash-card\\.winner");
    const author = delay("\\.lash-stage\\.reveal \\.lash-card \\.author");
    const points = delay("\\.lash-stage\\.reveal \\.lash-card \\.points");
    assert.ok(bars < hit && hit < author && author < points, `${bars} < ${hit} < ${author} < ${points}`);
    assert.ok(points + 0.4 < 6, "lands well inside the 6 s verdict");
  });

  it("quiets the chrome and ambient layer during matchups, and stills the reveal for reduced motion", () => {
    assert.match(css, /body:has\(\.lash-stage\) \.host-ambient \{\s*opacity: 0\.45/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.intro \.round,\s*\.lash-stage\.reveal \*/);
  });
});
