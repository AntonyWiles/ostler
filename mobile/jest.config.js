module.exports = {
  preset: 'jest-expo',
  // Only the plain-TypeScript tests; none of them loads a native module.
  testMatch: ['<rootDir>/__tests__/**/*.test.ts']
}
