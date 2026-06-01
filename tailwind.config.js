module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#f5efe4',
          50: '#faf7f2',
          100: '#f0e9da',
          200: '#e4d8c6',
          300: '#d4c3aa',
        },
        ink: {
          DEFAULT: '#1c1815',
          600: '#4a4038',
          500: '#6b625a',
          400: '#9a8f87',
          300: '#c2b9b3',
          200: '#ddd5d0',
          100: '#ede8e3',
        },
        rule: {
          DEFAULT: '#ddd2c2',
          light: '#ede8e0',
          dark: '#c5b8a6',
        },
        accent: {
          DEFAULT: '#9b2d20',
          hover: '#b83428',
          pale: '#fcecea',
          faint: '#f5dfdc',
        },
        grove: {
          DEFAULT: '#2d6a4f',
          light: '#d1ead9',
          muted: '#4a8a6a',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Noto Serif SC', 'Georgia', 'serif'],
        serif: ['Noto Serif SC', 'Georgia', 'serif'],
        sans: ['Noto Sans SC', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
