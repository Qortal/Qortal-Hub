class Statement {
  all() {
    return [];
  }

  get() {
    return undefined;
  }

  run() {
    return { changes: 0, lastInsertRowid: 0 };
  }
}

class MockDatabase {
  close() {
    return undefined;
  }

  exec() {
    return undefined;
  }

  prepare() {
    return new Statement();
  }

  pragma() {
    return undefined;
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: Parameters<T>) => fn(...args)) as T;
  }
}

export default MockDatabase;
export type Database = InstanceType<typeof MockDatabase>;
