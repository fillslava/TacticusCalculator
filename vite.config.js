/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@engine': path.resolve(__dirname, 'src/engine'),
            '@data': path.resolve(__dirname, 'src/data'),
            '@api': path.resolve(__dirname, 'src/api'),
            '@state': path.resolve(__dirname, 'src/state'),
            '@ui': path.resolve(__dirname, 'src/ui'),
            '@lib': path.resolve(__dirname, 'src/lib'),
        },
    },
    server: {
        proxy: {
            '/tacticus-api': {
                target: 'https://api.tacticusgame.com',
                changeOrigin: true,
                secure: true,
                rewrite: function (p) { return p.replace(/^\/tacticus-api/, ''); },
            },
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
