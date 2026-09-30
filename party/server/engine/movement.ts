// Shared deterministic first-person movement primitives for 3D CPI games.
// Rendering/collision stay outside this module so Cold Case and future games can use the same
// movement model on server, browser, and eventually a native client.

export interface MovementInput {
  forward: number;
  right: number;
  jump?: boolean;
  sprint?: boolean;
}
export interface MovementState {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  yaw: number; pitch: number; grounded: boolean;
}
export interface MovementConfig {
  walkSpeed: number; sprintSpeed: number; acceleration: number; airAcceleration: number;
  gravity: number; jumpVelocity: number; maxPitch: number; maxLookRate: number;
}
export const DEFAULT_MOVEMENT: Readonly<MovementConfig> = Object.freeze({
  walkSpeed: 3.6, sprintSpeed: 5.4, acceleration: 18, airAcceleration: 7,
  gravity: 15, jumpVelocity: 5.2, maxPitch: Math.PI * 0.49, maxLookRate: Math.PI * 2.5,
});
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function normalizeMove(forward:number,right:number){
  const length=Math.hypot(forward,right);
  if(length<=1)return {forward:clamp(forward,-1,1),right:clamp(right,-1,1)};
  return {forward:forward/length,right:right/length};
}
export function turn(state:MovementState,lookX:number,lookY:number,dt:number,config:MovementConfig=DEFAULT_MOVEMENT):MovementState{
  const scale=clamp(dt,0,.1)*config.maxLookRate;
  return {...state,yaw:state.yaw+clamp(lookX,-1,1)*scale,pitch:clamp(state.pitch+clamp(lookY,-1,1)*scale,-config.maxPitch,config.maxPitch)};
}
export function stepMovement(state:MovementState,input:MovementInput,dt:number,config:MovementConfig=DEFAULT_MOVEMENT):MovementState{
  const safeDt=clamp(dt,0,.05),move=normalizeMove(input.forward,input.right),speed=input.sprint?config.sprintSpeed:config.walkSpeed;
  const sin=Math.sin(state.yaw),cos=Math.cos(state.yaw);
  const targetX=(move.right*cos+move.forward*sin)*speed;
  const targetZ=(move.right*-sin+move.forward*cos)*speed;
  // Accelerate along the velocity difference as a vector so diagonals don't gain speed faster.
  const accel=(state.grounded?config.acceleration:config.airAcceleration)*safeDt;
  const dvx=targetX-state.vx,dvz=targetZ-state.vz,dv=Math.hypot(dvx,dvz);
  const k=dv<=accel?1:accel/dv;
  const vx=state.vx+dvx*k,vz=state.vz+dvz*k;
  let vy=state.vy-config.gravity*safeDt,y=state.y+vy*safeDt,grounded=state.grounded;
  if(input.jump&&grounded){vy=config.jumpVelocity;y=state.y+vy*safeDt;grounded=false;}
  if(y<=0){y=0;vy=0;grounded=true;}
  return {...state,x:state.x+vx*safeDt,y,z:state.z+vz*safeDt,vx,vy,vz,grounded};
}
export function makeMovementState(overrides:Partial<MovementState>={}):MovementState{
  return {x:0,y:0,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,grounded:true,...overrides};
}
