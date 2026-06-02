module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Vercel Geist 浅色模式色板 ──
        paper: {
          DEFAULT: '#ffffff',
          50: '#f9f9f9',
          100: '#f5f5f5',
          200: '#f0f0f0',
          300: '#e8e8e8',
        },
        ink: {
          DEFAULT: '#171717',
          600: '#333333',
          500: '#696b72',
          400: '#888888',
          300: '#d4d4d4',
          200: '#e8e8e8',
          100: '#f0f0f0',
        },
        rule: {
          DEFAULT: '#eaeaea',
          light: '#f0f0f0',
          dark: '#d4d4d4',
        },
        accent: {
          DEFAULT: '#000000',
          hover: '#333333',
          pale: '#f5f5f5',
          faint: '#f5f5f5',
        },
        grove: {
          DEFAULT: '#00a63e',
          light: '#ddf3e4',
          muted: '#00a63e',
        },
      },
      fontFamily: {
        display: ['Geist', 'Inter', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        serif: ['Geist', 'Inter', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        sans: ['Geist', 'Inter', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'SF Mono', 'JetBrains Mono', 'Consolas', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
    },
  },
  plugins: [],
}
