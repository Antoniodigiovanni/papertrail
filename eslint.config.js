import tseslint from 'typescript-eslint';
export default tseslint.config(
  {ignores:['dist/**','node_modules/**','public/vendor/**','.cache/**']},
  ...tseslint.configs.recommended,
  {files:['**/*.{ts,tsx,mjs}'],rules:{'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'no-empty':['error',{allowEmptyCatch:true}]}},
);
