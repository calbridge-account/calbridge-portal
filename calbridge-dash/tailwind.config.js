/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@tremor/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'slide-in-right': {
          '0%':   { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 0.22s ease-out',
      },
      colors: {
        // Calbridge brand — matches portal exactly
        brand: {
          DEFAULT: '#2d5a27',
          dark:    '#1e3a1a',
          mid:     '#3d7a35',
          light:   '#edf5ec',
        },
        // Keep blue as secondary/accent
        calbridge: {
          50:  '#edf5ec',
          100: '#d4e9d2',
          200: '#aad3a6',
          300: '#7fbc79',
          400: '#55a54d',
          500: '#3d7a35',
          600: '#2d5a27',
          700: '#1e3a1a',
          800: '#152b13',
          900: '#0c1c0b',
        },
      },
    },
  },
  plugins: [],
};
