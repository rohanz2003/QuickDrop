export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0b1326',
        surface: '#171f33',
        'surface-low': '#131b2e',
        'surface-high': '#222a3d',
        primary: '#c3c0ff',
        secondary: '#89ceff',
        accent: '#4f46e5',
        onsurface: '#dae2fd'
      },
      boxShadow: {
        glow: '0 10px 30px rgba(79, 70, 229, 0.24)'
      }
    }
  },
  plugins: []
};
