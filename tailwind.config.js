/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        water: '#0A1628',
        gold: '#C9A84C',
        sand: '#D4B483',
        stone: '#7A7A7A',
        dark: '#1A1208',
      },
      fontFamily: {
        serif: ['Amiri', 'Georgia', 'serif'],
        body: ['Amiri', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}