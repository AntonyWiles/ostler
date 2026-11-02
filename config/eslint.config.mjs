import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const NATIVE_DIALOG_MESSAGE =
  'Native dialogs are not allowed. Use useConfirm() for decisions and useToast() for messages (src/renderer/ui/).'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // .claude/ holds agent worktrees (whole copies of the repository), which are not ours to lint.
    ignores: ['out/**', 'dist/**', 'node_modules/**', '.claude/**', 'mobile/**']
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        process: 'readonly',
        require: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    // Snippets pasted into a browser console.
    files: ['agent-skills/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        getComputedStyle: 'readonly',
        console: 'readonly'
      }
    }
  },
  {
    // Native dialogs misbehave on Windows (focus is lost until alt-tab) and
    // cannot be styled or undone. Use the in-app ones from src/renderer/ui/.
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['confirm', 'alert', 'prompt'].map((name) => ({ name, message: NATIVE_DIALOG_MESSAGE }))
      ],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) =>
          ['confirm', 'alert', 'prompt'].map((property) => ({
            object,
            property,
            message: NATIVE_DIALOG_MESSAGE
          }))
        )
      ]
    }
  },
  {
    rules: {
      // `const { left, ...rest } = value` is how a key is left out of a copy: `left` is not unused.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true }
      ],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
)
