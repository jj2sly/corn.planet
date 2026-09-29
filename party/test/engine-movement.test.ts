import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MOVEMENT, makeMovementState, stepMovement, turn } from "../server/engine/movement.ts";
describe("first-person movement primitives",()=>{
 it("moves forward relative to camera yaw",()=>{const s=stepMovement(makeMovementState(),{forward:1,right:0},.05);assert.ok(s.z>0);assert.equal(s.x,0);});
 it("normalizes diagonal input",()=>{const a=stepMovement(makeMovementState(),{forward:1,right:0},.05),b=stepMovement(makeMovementState(),{forward:1,right:1},.05);assert.ok(Math.hypot(b.vx,b.vz)<=Math.hypot(a.vx,a.vz)+.001);});
 it("jumps and lands cleanly",()=>{let s=stepMovement(makeMovementState(),{forward:0,right:0,jump:true},.01);assert.equal(s.grounded,false);assert.ok(s.vy>0);for(let i=0;i<300;i++)s=stepMovement(s,{forward:0,right:0},.05);assert.equal(s.y,0);assert.equal(s.grounded,true);assert.equal(s.vy,0);});
 it("clamps pitch",()=>{const s=turn(makeMovementState(),1,1,10);assert.equal(s.pitch,DEFAULT_MOVEMENT.maxPitch);assert.ok(s.yaw>0);});
});
