// Types for casefile.js, so tests (TypeScript) can check the launch's timing.

export interface LaunchPace {
  paper: number;
  stagger: number;
  fly: number;
  folder: number;
  folderFly: number;
  stamp: number;
  declass: number;
  pop: number;
  exit: number;
  leave: number;
}

export declare const LAUNCH_PACES: { full: LaunchPace; quick: LaunchPace; calm: LaunchPace };
