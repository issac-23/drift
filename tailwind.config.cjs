/** Palette and type feel carried over from tend; soft category tints are drift's own. */
module.exports = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
        bg: '#0a0a0a',
        surface: '#161616',
        surface2: '#1f1f1f',
        border: '#2a2a2a',
        muted: '#7a7a7a',
        text: '#f5f5f5',
        accent: '#ffffff',
        school: '#9be0bf',
        emails: '#fde68a',
        work: '#a5b4fc',
        life: '#fdba9a',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        pop: 'pop 180ms ease-out',
        float: 'float 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        pop: { '0%': { transform: 'scale(0.96)' }, '60%': { transform: 'scale(1.03)' }, '100%': { transform: 'scale(1)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-2px)' } },
      },
    },
  },
  plugins: [],
}
