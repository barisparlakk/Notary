/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cal.com Inspired Clean Architecture
        cal: {
          bg: '#f9fafb',        // Light background canvas
          card: '#ffffff',      // Pure white elevated bento cards
          subtle: '#f3f4f6',    // Soft input/badge background
          border: '#e5e7eb',    // 1px crisp neutral border
          borderLight: '#f1f5f9',
          borderHover: '#d1d5db',
          text: '#111827',      // Deep black typography
          muted: '#64748b',     // Secondary slate text
          dark: '#0f172a',      // Primary dark elements
        },
        surface: {
          base: '#f9fafb',
          subtle: '#f3f4f6',
          panel: '#ffffff',
          elevated: '#ffffff',
          border: '#e5e7eb',
          borderLight: '#d1d5db',
        },
        accent: {
          DEFAULT: '#111827',   // Cal.com uses bold black as primary accent
          hover: '#27272a',
          active: '#09090b',
          blue: '#2563eb',
          blueSubtle: 'rgba(37, 99, 235, 0.08)',
        },
        status: {
          success: '#10b981',
          successBg: '#f0fdf4',
          successBorder: '#bbf7d0',
          successText: '#166534',
          error: '#ef4444',
          errorBg: '#fef2f2',
          errorBorder: '#fecaca',
          errorText: '#991b1b',
          warning: '#f59e0b',
          warningBg: '#fffbeb',
          warningBorder: '#fde68a',
          warningText: '#92400e',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
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