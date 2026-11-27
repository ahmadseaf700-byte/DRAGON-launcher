/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        dragon: {
          dark: "#090B12",
          panel: "#111622",
          card: "#171E2D",
          accent: "#E11D48",
          border: "#273247"
        }
      },
      boxShadow: {
        glow: "0 0 32px rgba(225, 29, 72, 0.18)"
      }
    }
  },
  plugins: []
};