import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

export default {
  plugins: [{
    name: 'dataset-write',
    configureServer(server) {
      server.middlewares.use('/dataset.json', (req, res, next) => {
        if (req.method !== 'PUT') return next()
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
          fs.writeFileSync(path.resolve('public/dataset.json'), body)
          res.end('ok')
        })
      })
    }
  }]
}
