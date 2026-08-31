import tseslint from 'typescript-eslint'
import prettierRecommended from 'eslint-plugin-prettier/recommended'

export default tseslint.config(
  { ignores: ['**/*.js', '**/*.mjs', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  prettierRecommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/no-non-null-assertion': 0,
      // wie im alten Setup (recommended v5) nur eine Warnung
      '@typescript-eslint/no-unused-vars': 'warn'
    }
  }
)
