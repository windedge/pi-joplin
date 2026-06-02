module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  moduleNameMapper: {
    '^typebox$': '<rootDir>/__mocks__/typebox.js',
    '^@earendil-works/pi-coding-agent$': '<rootDir>/__mocks__/pi-coding-agent.js'
  }
};
