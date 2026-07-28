const firebaseRulesPlugin = require('@firebase/eslint-plugin-security-rules');

module.exports = [
  {
    files: ["**/*.rules"],
    plugins: {
      "firebase-security-rules": firebaseRulesPlugin,
    },
    languageOptions: {
      parser: firebaseRulesPlugin.parser,
    },
    rules: {
      ...firebaseRulesPlugin.configs.recommended.rules
    }
  }
];
