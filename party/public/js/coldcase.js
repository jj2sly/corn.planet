const canvas=document.querySelector("#view"),gl=canvas.getContext("webgl");
const start=document.querySelector("#start"),begin=document.querySelector("#begin"),objective=document.querySelector("#objective"),tempEl=document.querySelector("#temp"),prompt=document.querySelector("#prompt"),repair=document.querySelector("#repair"),repairText=document.querySelector("#repairText"),repairButtons=document.querySelector("#repairButtons");
let started=false,room="KITCHEN",temperature=21,repairStep=0,doorOpen=false,last=0;
const rooms={KITCHEN:{w:16,d:14,h:7,color:[.56,.52,.45]},FRIDGE_ENTRANCE:{w:18,d:18,h:9,color:[.25,.31,.34]},PANTRY:{w:22,d:20,h:9,color:[.25,.29,.25]},POWER_ROOM:{w:18,d:16,h:9,color:[.18,.21,.22]}};
const p={x:0,y:1.6,z:4,yaw:0,pitch:0,forward:0,right:0,sprint:false};
const keys=new Set();
const vs=`attribute vec3 p; uniform mat4 mvp; uniform vec3 c; varying vec3 v; void main(){gl_Position=mvp*vec4(p,1.);v=c;}`;
const fs=`precision mediump float; varying vec3 v; void main(){gl_FragColor=vec4(v,1.);}`;
function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);return s}
const prog=gl.createProgram();gl.attachShader(prog,shader(gl.VERTEX_SHADER,vs));gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(prog);gl.useProgram(prog);
const loc=gl.getAttribLocation(prog,"p"),mvpLoc=gl.getUniformLocation(prog,"mvp"),colorLoc=gl.getUniformLocation(prog,"c");
const cube=new Float32Array([-1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1,-1,-1,1,1,-1,1,1,1,1,-1,1,1,-1,-1,-1,-1,1,-1,-1,1,-1,-1,-1,1,1,-1,1,1,1,1,1,1,-1,1,-1,1]);
const idx=new Uint16Array([0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4]);
const vb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,cube,gl.STATIC_DRAW);const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,idx,gl.STATIC_DRAW);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);gl.enable(gl.DEPTH_TEST);
function mul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o}
function ident(){const a=new Float32Array(16);a[0]=a[5]=a[10]=a[15]=1;return a}
function translate(x,y,z){const a=ident();a[12]=x;a[13]=y;a[14]=z;return a}
function scale(x,y,z){const a=ident();a[0]=x;a[5]=y;a[10]=z;return a}
function rotateY(t){const a=ident(),c=Math.cos(t),s=Math.sin(t);a[0]=c;a[2]=-s;a[8]=s;a[10]=c;return a}
function rotateX(t){const a=ident(),c=Math.cos(t),s=Math.sin(t);a[5]=c;a[6]=s;a[9]=-s;a[10]=c;return a}
function perspective(fov,aspect,n,f){const q=1/Math.tan(fov/2),a=new Float32Array(16);a[0]=q/aspect;a[5]=q;a[10]=(f+n)/(n-f);a[11]=-1;a[14]=2*f*n/(n-f);return a}
function box(x,y,z,w,h,d,c){const model=mul(translate(x,y,z),scale(w/2,h/2,d/2));gl.uniformMatrix4fv(mvpLoc,false,mul(view,model));gl.uniform3fv(colorLoc,c);gl.drawElements(gl.TRIANGLES,36,gl.UNSIGNED_SHORT,0)}
let view=ident();
function rebuildView(){view=mul(perspective(1.05,canvas.width/canvas.height,.05,100),mul(rotateX(p.pitch),mul(rotateY(p.yaw),translate(-p.x,-p.y,-p.z))));}
function draw(){const q=rooms[room];gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(...q.color,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);rebuildView();
box(0,-1,0,q.w,1,q.d,[.16,.18,.18]);box(0,q.h,0,q.w,.4,q.d,[.2,.22,.22]);
box(0,q.h/2,-q.d/2,q.w,q.h,.4,[.3,.32,.32]);box(-q.w/2,q.h/2,0,.4,q.h,q.d,[.3,.32,.32]);box(q.w/2,q.h/2,0,.4,q.h,q.d,[.3,.32,.32]);
if(room==="KITCHEN"){box(4,2,-2,3.2,6,3,[.72,.73,.7]);box(2.3,2,-2,.15,5.5,2.6,[.45,.6,.62]);box(-2,0,2,7,1,2,[.35,.36,.34]);}
if(room==="FRIDGE_ENTRANCE"){for(let z=-6;z<=6;z+=4){box(-5,1,z,1,4,3,[.42,.43,.4]);box(5,1,z,1,4,3,[.42,.43,.4]);}}
if(room==="PANTRY"){for(const x of [-6,0,6]){box(x,1,0,1,5,16,[.32,.28,.2]);box(x,.1,0,1.3,.15,16,[.55,.5,.4]);}box(3.5,1.2,1.5,1,2.4,1,[.92,.92,.84]);box(3.5,2.1,1.5,1.05,.5,1.02,[.65,.82,.9]);}
if(room==="POWER_ROOM"){box(0,2,-7.4,3.5,3,.5,[.08,.09,.09]);box(0,2,-7.05,2.8,2.3,.08,[.8,.58,.05]);}
prompt.textContent=room==="KITCHEN"&&!doorOpen&&p.z<1&&p.x>1?"[E] OPEN REFRIGERATOR":room==="FRIDGE_ENTRANCE"&&p.z<-6?"[E] ENTER PANTRY":room==="PANTRY"&&p.z<-7?"[E] ENTER POWER ROOM":room==="PANTRY"&&p.x>2&&p.x<5&&p.z<3?"[E] ADJUST TEMPERATURE":room==="POWER_ROOM"&&p.z<-5?"[E] OPEN POWER PANEL":"";}
function interact(){if(room==="KITCHEN"&&p.z<1&&p.x>1){room="FRIDGE_ENTRANCE";p.x=0;p.z=7;temperature=4;objective.textContent="OBJECTIVE: Explore the impossible refrigerator interior";return}
if(room==="FRIDGE_ENTRANCE"&&p.z<-6){room="PANTRY";p.x=0;p.z=7;temperature=6;objective.textContent="OBJECTIVE: Investigate the pantry";return}
if(room==="PANTRY"&&p.z<-7){room="POWER_ROOM";p.x=0;p.z=6;temperature=8;objective.textContent="OBJECTIVE: Restore main power";return}
if(room==="PANTRY"&&p.x>2&&p.x<5&&p.z<3){temperature=temperature<5?12:3;objective.textContent="OBJECTIVE: The milk reacted. Find the power system";return}
if(room==="POWER_ROOM"&&p.z<-5){repair.hidden=false;renderRepair();}}
function renderRepair(){const labels=["OPEN PANEL","COMPONENT A","COMPONENT B","RESET"];repairText.textContent=repairStep===0?"Open the panel.":repairStep===1?"Install component A.":repairStep===2?"Install component B.":"Reset the main breaker.";repairButtons.replaceChildren();labels.forEach((x,i)=>{const b=document.createElement("button");b.className="repair-btn";b.textContent=x;b.disabled=i!==repairStep;b.onclick=()=>{repairStep++;if(repairStep===4){repair.hidden=true;objective.textContent="OBJECTIVE: POWER RESTORED — CONTINUE DEEPER";temperature=8}else renderRepair()};repairButtons.append(b)})}
addEventListener("keydown",e=>{keys.add(e.code);if(e.code==="KeyE"&&!e.repeat&&started)interact()});addEventListener("keyup",e=>keys.delete(e.code));
canvas.addEventListener("click",()=>canvas.requestPointerLock?.());document.addEventListener("mousemove",e=>{if(document.pointerLockElement===canvas){p.yaw-=e.movementX*.002;p.pitch=Math.max(-1.2,Math.min(1.2,p.pitch-e.movementY*.002))}});
begin.onclick=()=>{started=true;start.hidden=true;objective.textContent="OBJECTIVE: Enter the refrigerator";canvas.requestPointerLock?.();};
function resize(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio}addEventListener("resize",resize);resize();
function tick(t){const dt=Math.min(.05,(t-last)/1000||0);last=t;if(started){p.forward=(keys.has("KeyW")||keys.has("ArrowUp")?1:0)-(keys.has("KeyS")||keys.has("ArrowDown")?1:0);p.right=(keys.has("KeyD")||keys.has("ArrowRight")?1:0)-(keys.has("KeyA")||keys.has("ArrowLeft")?1:0);const sp=keys.has("ShiftLeft")||keys.has("ShiftRight")?5:3;const f=p.forward*sp*dt,r=p.right*sp*dt;p.x+=Math.cos(p.yaw)*r+Math.sin(p.yaw)*f;p.z+=Math.cos(p.yaw)*f-Math.sin(p.yaw)*r;const q=rooms[room];p.x=Math.max(-q.w/2+1,Math.min(q.w/2-1,p.x));p.z=Math.max(-q.d/2+1,Math.min(q.d/2-1,p.z));tempEl.textContent=`TEMP ${temperature}°C`;draw()}requestAnimationFrame(tick)}requestAnimationFrame(tick);
