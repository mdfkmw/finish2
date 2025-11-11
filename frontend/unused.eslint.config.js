export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly'
      },
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', vars: 'all' }],
    },
  },
]
