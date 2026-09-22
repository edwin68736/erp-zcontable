/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b'
        },
        // Verde oscuro del fondo del sidebar: distinto del verde de marca (primary-*),
        // usado solo para el chrome del sidebar (texto/ícono activo, paneles flyout).
        sidebar: {
          light: '#0A3C45',
          DEFAULT: '#06343C',
          dark: '#042B33'
        }
      },
      // Antes: 18 valores mágicos (z-[9990] .. z-[10050]) elegidos ad hoc,
      // cada uno "un poco más alto que el mayor visto hasta ahora". Estos 4
      // niveles documentan la intención real y dejan espacio entre ellos.
      zIndex: {
        'panel-backdrop': '200',
        panel: '210',
        dialog: '300',
        toast: '400'
      },
      // Antes: text-[9px]/[10px]/[11px]/[13px]/[15px] repartidos a mano
      // (236 usos) como una escala "micro" no declarada. Estas dos cubren
      // el grueso (9px y el clúster 10-11px unificado en 11px).
      fontSize: {
        '3xs': ['9px', { lineHeight: '0.75rem' }],
        '2xs': ['11px', { lineHeight: '1rem' }]
      }
    },
  },
  plugins: [],
}
