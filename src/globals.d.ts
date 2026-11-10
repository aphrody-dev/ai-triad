interface SovereignProcess {
  readonly platform: string;
  readonly arch: string;
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
  readonly stdout: { write(chunk: string | Uint8Array): boolean };
  readonly stderr: { write(chunk: string | Uint8Array): boolean };
  exitCode?: number;
  cwd(): string;
  exit(code?: number): never;
}

declare const process: SovereignProcess;

interface SovereignServer {
  readonly hostname: string;
  readonly port: number;
  stop(closeActiveConnections?: boolean): void;
}

interface SovereignSpawnResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

interface SovereignFileSink {
  write(chunk: string | Uint8Array): number;
  flush(): number | Promise<number>;
  end(): number | Promise<number>;
}

interface SovereignAsyncProc {
  readonly stdin: SovereignFileSink;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  kill(signal?: number | string): void;
}

declare const Bun: {
  readonly version: string;
  readonly stdin: { stream(): AsyncIterable<Uint8Array> };
  readonly YAML: { parse(input: string): unknown };
  readonly TOML: { parse(input: string): unknown };
  readonly CryptoHasher: {
    hash(
      algo: string,
      data: string | Uint8Array,
      encoding: "hex" | "base64" | "base64url",
    ): string;
  };
  file(path: string): { text(): Promise<string>; exists(): Promise<boolean> };
  serve(options: {
    port?: number;
    hostname?: string;
    idleTimeout?: number;
    fetch(req: Request): Response | Promise<Response>;
  }): SovereignServer;
  spawn(
    cmd: string[],
    options?: {
      stdin?: "pipe" | "inherit" | "ignore" | Uint8Array;
      stdout?: "pipe" | "inherit" | "ignore";
      stderr?: "pipe" | "inherit" | "ignore";
      cwd?: string;
      env?: Record<string, string | undefined>;
    },
  ): SovereignAsyncProc;
  spawnSync(
    cmd: string[],
    options?: {
      stdin?: "pipe" | "inherit" | "ignore" | Uint8Array;
      stdout?: "pipe" | "inherit" | "ignore";
      stderr?: "pipe" | "inherit" | "ignore";
      cwd?: string;
      env?: Record<string, string | undefined>;
      timeout?: number;
    },
  ): SovereignSpawnResult;
};

interface ImportMeta {
  readonly dir: string;
  readonly url: string;
  readonly main: boolean;
}

declare module "node:fs" {
  export interface Dirent {
    readonly name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export interface Stats {
    readonly size: number;
    readonly mtime: Date;
    readonly mode: number;
  }
  export function existsSync(path: string): boolean;
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean; mode?: number },
  ): string | undefined;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(
    path: string,
    data: string | Uint8Array,
    options?: "utf8" | { encoding?: "utf8"; mode?: number },
  ): void;
  export function copyFileSync(src: string, dest: string): void;
  export function statSync(path: string): Stats;
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): Dirent[];
  export function chmodSync(path: string, mode: number): void;
}

declare module "node:path" {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
  export function relative(from: string, to: string): string;
}

declare module "node:os" {
  export function homedir(): string;
  export function tmpdir(): string;
}

declare module "bun:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: string): void;
    toMatch(expected: RegExp | string): void;
    toStartWith(expected: string): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeDefined(): void;
    not: {
      toBeNull(): void;
      toBe(expected: unknown): void;
      toContain(expected: string): void;
    };
  };
  export namespace expect {
    function arrayContaining(arr: readonly unknown[]): unknown;
  }
}
