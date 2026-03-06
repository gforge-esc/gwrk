export interface WudLogger {
  info(msg: string): void;
  stage(stage: string, iteration: number, total: number): void;
}

export function createWudLogger(feature: string, phase: string): WudLogger {
  throw new Error("Not implemented");
}
