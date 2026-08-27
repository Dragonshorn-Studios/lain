/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { wired: { 400: "#83d1c8", 500: "#3f8f91" } }, fontFamily: { mono: ["IBM Plex Mono", "monospace"], sans: ["Inter", "sans-serif"] } } },
  plugins: []
};
