// 最小配置，只开两条规则 —— 目的不是风格统一，是抓真 bug。
//
// 起因：仓库里有 6 处 `eslint-disable` 注释，但项目从来没装过 ESLint，
// 也就是说那些抑制注释从第一天起就是装饰品，它们压制的规则一次都没跑过。
// 其中 4 处压的正是 exhaustive-deps —— 而 2026-08-09 我自己就因为
// 依赖数组里写了一个不存在的变量（reloadNonce）而写出一个会白屏的 ReferenceError，
// 构建照样通过（Vite 不做类型检查）。这条规则当场就能证明自己值这两个依赖。
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-undef': 'error', // 就是这条能抓到"依赖数组里引用了不存在的变量"
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        localStorage: 'readonly', console: 'readonly', setTimeout: 'readonly',
        clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        fetch: 'readonly', crypto: 'readonly', alert: 'readonly', location: 'readonly',
        FileReader: 'readonly', Blob: 'readonly', URL: 'readonly', XMLHttpRequest: 'readonly',
        ResizeObserver: 'readonly', IntersectionObserver: 'readonly', Image: 'readonly',
        requestAnimationFrame: 'readonly', getComputedStyle: 'readonly', DOMParser: 'readonly',
        Element: 'readonly', structuredClone: 'readonly', HTMLElement: 'readonly', Node: 'readonly',
        URLSearchParams: 'readonly', confirm: 'readonly', FormData: 'readonly', AbortController: 'readonly',
        createImageBitmap: 'readonly', KeyboardEvent: 'readonly', MouseEvent: 'readonly',
      },
    },
  },
]
