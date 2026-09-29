export interface FixedStepClock {
  readonly stepSeconds: number;
  accumulator: number;
  elapsed: number;
  tick(deltaSeconds: number, update: (dt: number) => void): number;
}

export function createFixedStepClock(stepSeconds = 1 / 20): FixedStepClock {
  const clock: FixedStepClock = {
    stepSeconds: Math.max(0.001, stepSeconds),
    accumulator: 0,
    elapsed: 0,
    tick(deltaSeconds, update) {
      clock.accumulator += Math.max(0, Math.min(deltaSeconds, 0.25));
      let steps = 0;
      while (clock.accumulator >= clock.stepSeconds && steps < 8) {
        update(clock.stepSeconds);
        clock.accumulator -= clock.stepSeconds;
        clock.elapsed += clock.stepSeconds;
        steps++;
      }
      return steps;
    },
  };
  return clock;
}
