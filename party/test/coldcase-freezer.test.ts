import assert from "node:assert/strict"; import test from "node:test"; import {COLD_CASE_PROTOTYPE} from "../server/coldcase/level.ts";
test("Cold Case reaches freezer-era content",()=>{assert.ok(COLD_CASE_PROTOTYPE.rooms.some(r=>r.id==="FREEZER"));assert.ok(COLD_CASE_PROTOTYPE.food.some(f=>f.id==="icecream-01"));assert.equal(COLD_CASE_PROTOTYPE.repairs.length,2);});
