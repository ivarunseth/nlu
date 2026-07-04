import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Mirrors ALLOWED_ENVIRONMENTS in server/config.py: one control-plane
// (app.py) and one data-plane (triton.py) port pair per environment.
// Start the dev server against another stack with e.g. `FLASK_ENV=testing npm run dev`.
const PORTS = {
    development: { server: 5001, triton: 5002 },
    testing: { server: 5003, triton: 5004 },
    production: { server: 5005, triton: 5006 }
}
const { server, triton } = PORTS[process.env.FLASK_ENV || 'development']

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': {
                target: `http://127.0.0.1:${server}`,
                changeOrigin: true
            },
            '/triton': {
                target: `http://127.0.0.1:${triton}`,
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
