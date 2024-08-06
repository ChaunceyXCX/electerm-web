import log from '../common/log.js'
import socks from 'socksv5'
import net from 'net'

export function forwardRemoteToLocal ({
  conn,
  sshTunnelRemotePort,
  sshTunnelLocalPort,
  sshTunnelRemoteHost = '127.0.0.1',
  sshTunnelLocalHost = '127.0.0.1'
}) {
  return new Promise((resolve, reject) => {
    const result = `remote:${sshTunnelRemoteHost}:${sshTunnelRemotePort} => local:${sshTunnelLocalHost}:${sshTunnelLocalPort}`
    let server = null
    conn.on('tcp connection', (info, accept, reject) => {
      const srcStream = accept() // Source stream for forwarding
      conn.emit('forwardIn', srcStream)
    }).on('forwardIn', (srcStream) => {
      // Connect the local machine source stream to the local port
      server = net.connect(sshTunnelLocalPort, sshTunnelLocalHost)
      srcStream.pipe(server).pipe(srcStream)
    }).on('close', () => {
      server && server.close && server.close()
      log.log('SSH connection closed')
    })
    // Forward the remote server's port to the local machine's port
    conn.forwardIn(sshTunnelRemoteHost, sshTunnelRemotePort, (err) => {
      if (err) {
        log.error('Error forwarding port:', err)
        return reject(err)
      }
      log.log(`Port forwarded: ${result}`)
      resolve(1)
    })
  })
}

export function forwardLocalToRemote ({
  conn,
  sshTunnelRemotePort,
  sshTunnelLocalPort,
  sshTunnelRemoteHost = '127.0.0.1',
  sshTunnelLocalHost = '127.0.0.1'
}) {
  return new Promise((resolve, reject) => {
    const localServer = net.createServer((socket) => {
      conn.forwardOut(sshTunnelLocalHost, sshTunnelLocalPort, sshTunnelRemoteHost, sshTunnelRemotePort, (err, remoteSocket) => {
        if (err) {
          log.error('Error forwarding connection:', err)
          socket.end()
          return reject(err)
        }
        socket.pipe(remoteSocket).pipe(socket)
      })
    })
    // Start listening for local connections
    localServer.listen(sshTunnelLocalPort, sshTunnelLocalHost, () => {
      log.log(`Local server listening on port ${sshTunnelLocalPort}`)
      resolve(1)
    })
    localServer.on('error', (err) => {
      log.error('Error listening for local connections:', err)
      reject(err)
    })
    conn.on('close', () => {
      localServer && localServer.close()
    })
  })
}

export function dynamicForward ({
  conn,
  sshTunnelLocalPort,
  sshTunnelLocalHost = '127.0.0.1'
}) {
  return new Promise((resolve, reject) => {
    const dproxyServer = socks.createServer((info, accept, deny) => {
      conn.forwardOut(
        info.srcAddr,
        info.srcPort,
        info.dstAddr,
        info.dstPort,
        (err, stream) => {
          if (err) {
            deny()
            return reject(err)
          }
          const clientSocket = accept(true)
          if (clientSocket) {
            stream.pipe(clientSocket).pipe(stream)
          }
        })
    })
    dproxyServer.listen(sshTunnelLocalPort, sshTunnelLocalHost, () => {
      log.log(`SOCKS server listening on ${sshTunnelLocalHost}:${sshTunnelLocalPort}`)
      resolve(1)
    }).useAuth(socks.auth.None())
    dproxyServer.on('error', (err) => {
      log.error('Error listening for local connections:', err)
      reject(err)
    })
    // close socks proxy when ssh connection is closed.
    conn.on('close', () => {
      dproxyServer && dproxyServer.close()
    })
  })
}
