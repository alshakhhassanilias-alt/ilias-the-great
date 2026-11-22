/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Cinzel', 'Georgia', 'serif'],
        serif: ['"Old Standard TT"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: { 950: '#07090d', 900: '#0c1017', 850: '#111722', 800: '#161d2a', 700: '#202a3b', 600: '#2c3a51', 500: '#41516d' },
        gold: { 300: '#f3dc9b', 400: '#e8c46a', 500: '#d4a63f', 600: '#a9802a' },
        parchment: { 100: '#f6edd9', 200: '#ecdcb9', 300: '#dcc497' },
      },
      boxShadow: { panel: '0 8px 30px rgba(0,0,0,.45)' },
    },
  },
  plugins: [],
}
