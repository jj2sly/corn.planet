import assert from "node:assert/strict";
import test from "node:test";
import { COLD_CASE_PROTOTYPE } from "../server/coldcase/level.ts";

test("Cold Case prototype has a connected first playable slice",()=>{
 assert.equal(COLD_CASE_PROTOTYPE.id,"cold-case-prototype");
 assert.deepEqual(COLD_CASE_PROTOTYPE.rooms.map(r=>r.id),["KITCHEN","FRIDGE_ENTRANCE","PANTRY","FREEZER","TECHNICIAN_OUTPOST","POWER_ROOM"]);
 assert.equal(COLD_CASE_PROTOTYPE.food[0]?.name,"Milk Carton");
 assert.equal(COLD_CASE_PROTOTYPE.food[1]?.name,"Ice Cream Block");
 assert.equal(COLD_CASE_PROTOTYPE.repairs[0]?.id,"POWER");
 assert.equal(COLD_CASE_PROTOTYPE.repairs[1]?.id,"COOLING");
 assert.equal(COLD_CASE_PROTOTYPE.repairs[0]?.unlocks,"FREEZER");
 assert.equal(COLD_CASE_PROTOTYPE.checkpoint,"pantry-checkpoint");
});
