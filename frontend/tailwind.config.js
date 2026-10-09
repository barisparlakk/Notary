/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Notary renk sistemi: soğuk bir kâğıt zemini, mürekkep gibi koyu metin, durumu anlatan üç mühür mürekkebi.
        ink: '#161B33',
        paper: '#F5F6F8',
        rule: '#D9DCE5',
        verified: '#0F7B5F',
        altered: '#C2362F',
        pending: '#3057D5',
        revoked: '#A15C07',
        // Gri ölçeği mürekkep tonundan türetildi; mevcut ekranlar kendiliğinden bu soğuk tona geçer.
        // gray-500 (#5F6678) paper ve beyaz üzerinde >= 5:1; gray-400 metin için kullanılmaz.
        gray: {
          50: '#F5F6F8',
          100: '#ECEEF2',
          200: '#D9DCE5',
          300: '#C2C7D4',
          400: '#9AA1B2',
          500: '#5F6678',
          600: '#484E60',
          700: '#343A4D',
          800: '#232842',
          900: '#1A1F38',
          950: '#161B33',
        },
        // Eski ekranların kullandığı adlar (aşama b/c'de kalkacak)
        cal: {
          bg: '#F5F6F8',
          card: '#ffffff',
          subtle: '#ECEEF2',
          border: '#D9DCE5',
          borderLight: '#ECEEF2',
          borderHover: '#C2C7D4',
          text: '#161B33',
          muted: '#5F6678',
          dark: '#161B33',
        },
        accent: {
          DEFAULT: '#161B33',
          hover: '#232842',
          active: '#161B33',
          blue: '#3057D5',
          blueSubtle: 'rgba(48, 87, 213, 0.08)',
        },
      },
      fontFamily: {
        sans: ['"Hanken Grotesk"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        // "Belge sesi": yalnızca sayfa başlıkları ve sonuç cümleleri
        display: ['"Source Serif 4"', 'Georgia', 'Cambria', 'serif'],
        // Yalnızca hash ve adresler için; sistem mono yazı tipi
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'cal-card': '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)',
        'cal-hover': '0 12px 24px -4px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.03)',
        'cal-modal': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      maxWidth: {
        'page': '1200px',
      }
    },
  },
  plugins: [],
}