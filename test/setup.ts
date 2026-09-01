// aws-sdk v2 (used as a signing oracle in tests) expects Node's `global`
// when bundled for the browser test environment.
(globalThis as any).global = globalThis;
