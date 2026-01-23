import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

// Get git version tag, with fallback for Docker builds
let gitVersion = 'unknown'
try {
  gitVersion = execSync('git describe --tags --always').toString().trim()
} catch (error) {
  // Git not available (e.g., in Docker), use package.json version or env var
  gitVersion = process.env.APP_VERSION || 'dev'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(gitVersion),
  },
})
