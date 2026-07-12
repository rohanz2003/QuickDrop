export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--color-background) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-low': 'rgb(var(--color-surface-low) / <alpha-value>)',
        'surface-high': 'rgb(var(--color-surface-high) / <alpha-value>)',
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        secondary: 'rgb(var(--color-secondary) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        onsurface: 'rgb(var(--color-onsurface) / <alpha-value>)',
        'onsurface-variant': 'rgb(var(--color-onsurface-variant) / <alpha-value>)',
        error: 'rgb(var(--color-error) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)'
      },
      boxShadow: {
        glow: '0 0 30px rgba(79, 70, 229, 0.25)',
        'glow-lg': '0 0 60px rgba(79, 70, 229, 0.15)',
        'glow-sm': '0 0 15px rgba(79, 70, 229, 0.15)'
      },
      animation: {
        'scan-line': 'scanLine 2s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'bounce-in': 'bounceIn 0.5s ease-out'
      },
      keyframes: {
        scanLine: {
          '0%, 100%': { top: '0%' },
          '50%': { top: '100%' }
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(79, 70, 229, 0.2)' },
          '50%': { boxShadow: '0 0 40px rgba(79, 70, 229, 0.5)' }
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        bounceIn: {
          '0%': { opacity: '0', transform: 'scale(0.9)' },
          '50%': { opacity: '1', transform: 'scale(1.02)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        }
      }
    }
  },
  plugins: []
};
