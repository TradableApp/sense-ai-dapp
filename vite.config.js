import path from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';
import svgr from 'vite-plugin-svgr';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		react(),
		svgr(),
		VitePWA({
			registerType: 'autoUpdate',
			workbox: {
				// We are increasing the limit for files that can be precached by the service worker.
				// This allows our large-but-essential vendor chunks to be available offline.
				maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'google-fonts',
							expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
							cacheableResponse: { statuses: [0, 200] },
						},
					},
					{
						urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webm|mp4)$/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'media-cache',
							expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
							cacheableResponse: { statuses: [0, 200] },
						},
					},
				],
			},
			// This is the manifest configuration, aligned with your main project's manifest.json.
			manifest: {
				id: 'senseai.tradable.app',
				name: 'SenseAI Agent by Tradable',
				short_name: 'SenseAI',
				description: 'The dApp interface for the SenseAI tokenized AI agent.',
				start_url: '/?source=pwa',
				scope: '/',
				display: 'standalone',
				display_override: ['window-controls-overlay', 'standalone'],
				categories: [
					'finance',
					'productivity',
					'utilities',
					'trading',
					'cryptocurrency',
					'sentiment',
					'market',
					'insights',
				],
				background_color: '#020A3B',
				theme_color: '#020A3B',
				shortcuts: [
					{
						name: 'New Chat',
						short_name: 'Chat',
						description: 'Start a new conversation with the AI agent',
						url: '/chat?source=pwa_shortcut',
						icons: [{ src: '/icons/shortcut-chat-96x96.png', sizes: '96x96' }],
					},
					{
						name: 'Conversation History',
						short_name: 'History',
						description: 'View your past conversations',
						url: '/history?source=pwa_shortcut',
						icons: [{ src: '/icons/shortcut-history-96x96.png', sizes: '96x96' }],
					},
				],
				icons: [
					{ src: '/icons/icon-48x48.png', sizes: '48x48', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-144x144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
					{ src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
					{
						src: '/icons/icon-512x512-maskable.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable',
					},
				],
			},
		}),
		nodePolyfills({
			globals: {
				Buffer: true,
				global: true,
				process: true,
			},
			protocolImports: true,
		}),
	],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
	build: {
		// Adjust the warning limit to silence the cosmetic warning for the large vendor chunks.
		chunkSizeWarningLimit: 2500,
		rollupOptions: {
			onwarn(warning, warn) {
				if (warning.code === 'INVALID_ANNOTATION' && warning.message.includes('__PURE__')) {
					return;
				}
				warn(warning);
			},
		},
	},
});
