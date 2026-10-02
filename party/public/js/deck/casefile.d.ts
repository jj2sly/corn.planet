// Types for casefile.js, so tests (TypeScript) can check the launch's timing and clock.

export interface LaunchPace {
  paper: number;
  stagger: number;
  fly: number;
  folder: number;
  folderFly: number;
  clip: number;
  tag: number;
  strip: number;
  print: number;
  redact: number;
  stamp: number;
  declass: number;
  pop: number;
  exit: number;
  leave: number;
}

export declare const LAUNCH_PACES: { full: LaunchPace; quick: LaunchPace; calm: LaunchPace };
export declare const SKIP_LEAVE: number;
export declare function launchCues(t: LaunchPace, options?: { calm?: boolean }): { at: number; cue: string; volume: number }[];
export declare function launchTimeline<Id>(
  t: LaunchPace,
  options: {
    calm?: boolean;
    sound: (cue: string, volume: number) => void;
    exit: (skipped: boolean) => void;
    schedule?: (fn: () => void, ms: number) => Id;
    cancel?: (id: Id) => void;
  },
): { skip(): void; readonly over: boolean };
export declare function shouldPlayLaunch(previous: string | null | undefined, next: string): boolean;
export declare function caseNumber(id: string): string;
