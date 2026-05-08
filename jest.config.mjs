// Jest config for ESM-style tests in this project.
// Tests run with --experimental-vm-modules (see npm scripts) so .mjs/.js
// files load as native ESM. We treat .mjs files as ES modules explicitly.
export default {
  testEnvironment: 'node',
  moduleFileExtensions: ['mjs', 'js', 'cjs', 'json'],
  testMatch: ['<rootDir>/tests/**/*.test.mjs'],
  transform: {},
  testTimeout: 30000,
  // Suites share the local `sentences-test` index — run serially to avoid
  // create/delete race conditions between worker processes.
  maxWorkers: 1,
}
