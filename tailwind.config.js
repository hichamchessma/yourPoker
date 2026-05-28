/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        poker: {
          dark: '#0a0f1a',
          darker: '#060b14',
          navy: '#0d1526',
          blue: '#1a2840',
          gold: '#c9a227',
          'gold-light': '#e8c547',
          'gold-dark': '#a07d10',
          teal: '#00d4ff',
          'teal-dim': '#0099bb',
          card: 'rgba(255,255,255,0.05)',
          border: 'rgba(255,255,255,0.08)'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Rajdhani', 'Inter', 'sans-serif']
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg, #c9a227 0%, #e8c547 50%, #a07d10 100%)',
        'dark-gradient': 'linear-gradient(180deg, #0d1526 0%, #060b14 100%)',
        'card-gradient': 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)'
      },
      boxShadow: {
        gold: '0 0 20px rgba(201,162,39,0.3), 0 0 60px rgba(201,162,39,0.1)',
        teal: '0 0 20px rgba(0,212,255,0.3)',
        card: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)'
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'slide-up': 'slideUp 0.5s ease-out'
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' }
        },
        glow: {
          from: { boxShadow: '0 0 10px rgba(201,162,39,0.2)' },
          to: { boxShadow: '0 0 30px rgba(201,162,39,0.5)' }
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: []
}
