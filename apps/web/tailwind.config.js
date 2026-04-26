/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F5F1E8',
        ink: {
          DEFAULT: '#000000',
          2: '#52524E',
          3: '#9B9790',
          4: '#C8C4BC',
        },
        rule: '#D4CFC3',
        a: {
          DEFAULT: '#1A5F8A',
          light: '#C4DCE8',
          pale: '#EDF4F8',
        },
        b: {
          DEFAULT: '#6BA3BE',
          light: '#D4E8F0',
          pale: '#F0F6F9',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        label: '0.12em',
        wide2: '0.08em',
      },
    },
  },
  plugins: [],
}
