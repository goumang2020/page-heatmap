import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['dist/**', 'demo-dist/**', 'coverage/**', 'heatmap/**', 'examples/**', 'build/**', 'benchmarks/.cache/**', 'node_modules/**'] }, ...tseslint.configs.recommended, { files: ['**/*.mjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } });
