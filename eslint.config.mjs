import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/functions/deploy/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/essential'],
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: tseslint.parser } } },
)
