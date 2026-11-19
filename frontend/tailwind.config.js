/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f3efe7',
        paper: '#fffcf7',
        ink: '#1c3334',
        muted: '#6f6860',
        line: '#ddd5c8',
        navy: '#1c3334',
        accent: {
          DEFAULT: '#c96b45',
          soft: '#f3e0d4',
        },
        ok: {
          DEFAULT: '#2f6b3a',
          bg: '#e7f0e4',
        },
        warn: {
          DEFAULT: '#9a5b1f',
          bg: '#fff0df',
        },
        danger: {
          DEFAULT: '#a33b2d',
          bg: '#f8e8e4',
        },
      },
      borderRadius: {
        card: '1.25rem',
      },
      boxShadow: {
        card: '0 12px 28px rgba(28, 51, 52, 0.08)',
      },
      fontFamily: {
        sans: [
          '"Hiragino Sans"',
          '"Hiragino Kaku Gothic ProN"',
          '"Noto Sans JP"',
          'Meiryo',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
