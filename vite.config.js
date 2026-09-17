import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Everything the UI calls is under /api (one prefix per blueprint) or
// /socket.io. Locally `python app.py` serves all of it on PORT.
const port = process.env.PORT || 5000
const target = `http://127.0.0.1:${port}`

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': { target, changeOrigin: true },
            '/socket.io': { target, changeOrigin: true, ws: true }
        },
        watch: {
            ignored: ['**/venv/**']
        }
    }
})
