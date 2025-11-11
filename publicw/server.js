const next = require('next')
const http = require('http')

const port = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOST || '0.0.0.0'
const dev = process.env.NODE_ENV !== 'production'

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app
  .prepare()
  .then(() => {
    http
      .createServer((req, res) => {
        res.on('error', (err) => {
          console.error('Response error:', err)
        })
        handle(req, res)
      })
      .listen(port, hostname, (err) => {
        if (err) {
          console.error('Failed to start server', err)
          process.exit(1)
        }
        console.log(`> Ready on http://${hostname}:${port} (dev=${dev})`)
      })
  })
  .catch((err) => {
    console.error('Error during Next.js init', err)
    process.exit(1)
  })