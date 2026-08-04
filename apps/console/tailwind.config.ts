import type { Config } from 'tailwindcss';

// 设计系统：Flat + Minimalism；主色 teal 避开平台品牌色；语义 token，组件内禁裸 hex
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#0D9488', foreground: '#FFFFFF' },
        accent: { DEFAULT: '#EA580C', foreground: '#FFFFFF' },
        background: '#F8FAFC',
        foreground: '#1E293B',
        card: '#FFFFFF',
        muted: { DEFAULT: '#E9EFF8', foreground: '#64748B' },
        border: '#E2E8F0',
        success: '#16A34A',
        destructive: '#DC2626',
        warning: '#D97706',
        info: '#2563EB',
      },
      fontFamily: {
        sans: [
          'Inter',
          'Noto Sans SC',
          'Noto Sans JP',
          'Noto Sans KR',
          'Noto Sans Arabic',
          'Noto Sans Thai',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
