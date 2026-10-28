import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['dist/**', 'coverage/**', 'heatmap/**', 'examples/**', 'build/**', 'node_modules/**'] }, ...tseslint.configs.recommended, { files: ['**/*.mjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } });
