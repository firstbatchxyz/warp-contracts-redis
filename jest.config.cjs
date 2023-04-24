/** @type {import('jest').Config} */
// eslint-disable-next-line no-undef
module.exports = {
  clearMocks: true,
  moduleFileExtensions: ["ts", "js"],
  testPathIgnorePatterns: ["/.yalc/", "/data/", "/_helpers"],
  testEnvironment: "node",
  transformIgnorePatterns: ["<rootDir>/node_modules/(?!@assemblyscript/.*)"],
  transform: {
    "^.+\\.(ts|js)$": "ts-jest",
  },
  // do this to always show a summary of failed tests, even if there is only one
  // reporters: [["default", { summaryThreshold: 1 }]],
};
