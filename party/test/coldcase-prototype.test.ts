import assert from "node:assert/strict";
import test from "node:test";
import { COLD_CASE_PROTOTYPE } from "../server/coldcase/level.ts";
test("Cold Case prototype has connected first playable slice",()=>{
 assert.equal(COLD_CASE_PROTOTYPE.id,"cold-case-prototype");
 assert.deepEqual(COLD_CASE_PROTOTYPE.rooms.map(r=>r.id),["KITCHEN","FRIDGE_ENTRANCE","PANTRY","POWER_ROOM"]);
 assert.equal(COLD_CASE_PROTOTYPE.food[0].name,"Milk Carton");
 assert.equal(COLD_CASE_PROTOTYPE.repairs[0].id,"POWER");
});
