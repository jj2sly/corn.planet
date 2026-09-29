export interface StateEnvelope<T> {
  version: number;
  state: T;
}

export class AuthoritativeState<T> {
  private version = 0;
  private state: T;

  constructor(initial: T) {
    this.state = structuredClone(initial);
  }

  read(): StateEnvelope<T> {
    return { version: this.version, state: structuredClone(this.state) };
  }

  replace(next: T): StateEnvelope<T> {
    this.state = structuredClone(next);
    this.version++;
    return this.read();
  }

  update(mutator: (state: T) => T): StateEnvelope<T> {
    return this.replace(mutator(structuredClone(this.state)));
  }

  changedSince(version: number): boolean {
    return this.version > version;
  }

  getVersion(): number {
    return this.version;
  }
}
