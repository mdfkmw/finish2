import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}','./components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#2FA84F', 600: '#228E42', 700: '#1C7A36' },
        brandTeal: '#2ECBC6',
        slatebg: '#0f1324',
        slatebg2: '#0b1020'
      },
      boxShadow: { soft: '0 10px 30px rgba(0,0,0,0.25)' }
    }
  },
  plugins: []
} satisfies Config
