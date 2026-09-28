import react from "@vitejs/plugin-react";
// defineConfig из vitest/config, а не из vite: здесь же живёт секция test
import { defineConfig } from "vitest/config";

/**
 * Веб собирается в dist/web — его потом отдаёт сервер из того же процесса,
 * поэтому в проде это один контейнер, а не два.
 */
export default defineConfig({
	plugins: [react()],
	build: {
		outDir: "dist/web",
		emptyOutDir: true,
		sourcemap: true,
	},
	server: {
		port: 5173,
		// в деве интерфейс ходит в API на порт сервера
		proxy: {
			"/api": {
				target: "http://localhost:3000",
				changeOrigin: true,
				// SSE нельзя буферизовать, иначе события придут пачкой в конце
				configure: (proxy) => {
					proxy.on("proxyRes", (proxyRes) => {
						if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
							proxyRes.headers["cache-control"] = "no-cache, no-transform";
						}
					});
				},
			},
		},
	},
	test: {
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		environment: "node",
	},
});
