import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Mirrors ALLOWED_ENVIRONMENTS in server/config.py: one control-plane
// (app.py) and one data-plane (triton.py) port pair per environment.
// Start the dev server against another stack with e.g. `FLASK_ENV=production npm run dev`.
const PORTS = {
    testing: { server: 5001, triton: 5002 },
    production: { server: 5003, triton: 5004 }
}
const { server, triton } = PORTS[process.env.FLASK_ENV || 'testing']

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api/infer': {
                target: `http://127.0.0.1:${triton}`,
                changeOrigin: true
            },
            '/api': {
                target: `http://127.0.0.1:${server}`,
                changeOrigin: true
            },
            '/socket.io': {
                target: `http://127.0.0.1:${server}`,
                changeOrigin: true,
                ws: true
            }
        },
        watch: {
            ignored: ['**/venv/**']
        }
    }
})
