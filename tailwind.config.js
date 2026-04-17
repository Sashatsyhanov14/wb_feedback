/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.{html,js}",
    "./src/**/*.{html,js}"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        "surface": "#131313",
        "tertiary-fixed": "#ffdbcc",
        "primary-fixed": "#d8e2ff",
        "secondary": "#adc6ff",
        "surface-container": "#201f1f",
        "on-background": "#e5e2e1",
        "error-container": "#93000a",
        "on-tertiary": "#571e00",
        "on-secondary": "#082f65",
        "background": "#131313",
        "surface-container-low": "#1c1b1b",
        "on-primary": "#002e69",
        "inverse-on-surface": "#313030",
        "inverse-surface": "#e5e2e1",
        "tertiary": "#ffb595",
        "on-secondary-fixed": "#001a41",
        "inverse-primary": "#005bc1",
        "secondary-fixed": "#d8e2ff",
        "on-error": "#690005",
        "surface-variant": "#353534",
        "surface-bright": "#393939",
        "on-primary-fixed-variant": "#004493",
        "on-surface-variant": "#c1c6d7",
        "outline-variant": "#414755",
        "surface-container-high": "#2a2a2a",
        "on-error-container": "#ffdad6",
        "surface-container-highest": "#353534",
        "primary-fixed-dim": "#adc6ff",
        "outline": "#8b90a0",
        "on-primary-fixed": "#001a41",
        "secondary-container": "#26467d",
        "on-tertiary-fixed-variant": "#7c2e00",
        "primary": "#adc6ff",
        "surface-tint": "#adc6ff",
        "surface-dim": "#131313",
        "primary-container": "#4b8eff",
        "on-surface": "#e5e2e1",
        "on-tertiary-container": "#4c1a00",
        "surface-container-lowest": "#0e0e0e",
        "on-secondary-container": "#98b5f3",
        "tertiary-fixed-dim": "#ffb595",
        "tertiary-container": "#ef6719",
        "error": "#ffb4ab",
        "on-primary-container": "#00285c",
        "on-tertiary-fixed": "#351000",
        "on-secondary-fixed-variant": "#26467d",
        "secondary-fixed-dim": "#adc6ff"
      },
      borderRadius: {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "full": "9999px"
      },
      fontFamily: {
        "headline": ["Manrope", "sans-serif"],
        "body": ["Inter", "sans-serif"],
        "label": ["Inter", "sans-serif"]
      }
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries'),
  ],
}
