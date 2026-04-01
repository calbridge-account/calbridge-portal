/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@tremor/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#2d5a27',
          dark:    '#1e3a1a',
          light:   '#e8f0e7',
        },
      },
    },
  },
  plugins: [],
}
