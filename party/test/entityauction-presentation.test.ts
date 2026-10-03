// Entity Auction's show presentation: the host headlines the bid and the reveal, the phone keeps a
// few big bid buttons and the same server action. Rules are tested in entityauction.test.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8");

describe("Entity Auction presentation", () => {
  const phone = read("js/games/entityauction-play.js");
  const host = read("js/games/entityauction-host.js");
  const css = read("css/party.css");

  it("the phone still sends only bids, quick or custom, through the same action", () => {
    const actions = new Set([...phone.matchAll(/action: "([a-z]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...actions], ["bid"]);
    assert.match(phone, /payload: \{ amount: value \}/);
    assert.match(phone, /place\(v\)/, "quick bids");
    assert.match(phone, /place\(me\.kernels\)/, "all in");
    assert.match(phone, /ea-custom/, "the custom amount is tucked into details");
  });

  it("the host tags the phase so the headline, reveal and quiet chrome can follow it", () => {
    assert.match(host, /ea ea-show/);
    assert.match(host, /node\.dataset\.phase = ng\.phase/);
    assert.match(css, /\.ea-show\[data-phase="REVEALED"\] \.ea-readout dd\.big \{\s*animation: ea-hit/);
    assert.match(css, /body:has\(\.ea-show\[data-phase="BIDDING"\]\) \.host-ambient \{\s*opacity: 0\.5/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.ea-show \.ea-readout dd\.big/);
  });

  it("player-facing lines stay short", () => {
    for (const line of [...phone.matchAll(/"([A-Z][^"]{3,60}\.)"/g)].map((m) => m[1]!)) assert.ok(line.length <= 40, line);
  });
});
