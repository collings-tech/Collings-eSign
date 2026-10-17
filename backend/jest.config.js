module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.js'],
  setupFiles: ['<rootDir>/test/setup.js'],
  testTimeout: 60000,
};
