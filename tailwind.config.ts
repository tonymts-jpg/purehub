import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}", "./lib/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#171319",
        cream: "#f8f5ef",
        coral: "#ff6b6b",
        violet: "#7957e8"
      },
      boxShadow: {
        soft: "0 22px 60px rgba(45, 30, 53, .10)"
      }
    }
  },
  plugins: []
} satisfies Config;
