export type ColdCaseRoomId = "KITCHEN" | "FRIDGE_ENTRANCE" | "PANTRY" | "POWER_ROOM";
export type ColdCaseRepairId = "POWER";
export interface ColdCaseBox { id:string; position:[number,number,number]; size:[number,number,number]; material:"wall"|"floor"|"metal"|"glass"|"shelf"|"panel"; }
export interface ColdCaseRoom { id:ColdCaseRoomId; name:string; temperature:number; boxes:ColdCaseBox[]; }
export interface ColdCaseFood { id:string; name:string; room:ColdCaseRoomId; preferredTemperature:number; trigger:"TEMPERATURE"; }
export interface ColdCaseRepair { id:ColdCaseRepairId; name:string; room:ColdCaseRoomId; steps:string[]; unlocks:ColdCaseRoomId; }
export interface ColdCaseLevel { id:"cold-case-prototype"; rooms:ColdCaseRoom[]; food:ColdCaseFood[]; repairs:ColdCaseRepair[]; checkpoint:string; }

const box=(id:string,position:[number,number,number],size:[number,number,number],material:ColdCaseBox["material"]):ColdCaseBox=>({id,position,size,material});

export const COLD_CASE_PROTOTYPE:ColdCaseLevel={
 id:"cold-case-prototype",
 rooms:[
  {id:"KITCHEN",name:"Kitchen",temperature:21,boxes:[
   box("k-floor",[0,-1.5,0],[16,1,14],"floor"),box("k-back",[0,2,-7],[16,7,1],"wall"),
   box("k-left",[-8,2,0],[1,7,14],"wall"),box("k-right",[8,2,0],[1,7,14],"wall"),
   box("counter",[-2,0,2],[7,1,2],"metal"),box("fridge",[4,2,-2],[3.2,6,3],"metal"),
   box("fridge-door",[2.35,2,-2],[.12,5.6,2.65],"glass")
  ]},
  {id:"FRIDGE_ENTRANCE",name:"Impossible Refrigerator Interior",temperature:4,boxes:[
   box("i-floor",[0,-1.5,0],[18,1,18],"floor"),box("i-back",[0,3,-9],[18,9,1],"wall"),
   box("i-left",[-9,3,0],[1,9,18],"wall"),box("i-right",[9,3,0],[1,9,18],"wall"),
   box("shelf-l",[-5,1,0],[1,4,14],"shelf"),box("shelf-r",[5,1,0],[1,4,14],"shelf")
  ]},
  {id:"PANTRY",name:"Pantry",temperature:6,boxes:[
   box("p-floor",[0,-1.5,0],[22,1,20],"floor"),box("p-back",[0,3,-10],[22,9,1],"wall"),
   box("p-left",[-11,3,0],[1,9,20],"wall"),box("p-right",[11,3,0],[1,9,20],"wall"),
   box("p-s1",[-6,1,0],[1,5,16],"shelf"),box("p-s2",[0,1,0],[1,5,16],"shelf"),
   box("p-s3",[6,1,0],[1,5,16],"shelf"),box("power-door",[0,2,-9.45],[4,5,.4],"metal")
  ]},
  {id:"POWER_ROOM",name:"Power Room",temperature:8,boxes:[
   box("e-floor",[0,-1.5,0],[18,1,16],"floor"),box("e-back",[0,3,-8],[18,9,1],"wall"),
   box("e-left",[-9,3,0],[1,9,16],"wall"),box("e-right",[9,3,0],[1,9,16],"wall"),
   box("power-panel",[0,2,-7.4],[3.5,3,.5],"panel")
  ]}
 ],
 food:[{id:"milk-01",name:"Milk Carton",room:"PANTRY",preferredTemperature:4,trigger:"TEMPERATURE"}],
 repairs:[{id:"POWER",name:"Restore Main Power",room:"POWER_ROOM",steps:["OPEN_PANEL","COMPONENT_A","COMPONENT_B","RESET"],unlocks:"POWER_ROOM"}],
 checkpoint:"pantry-checkpoint"
};
