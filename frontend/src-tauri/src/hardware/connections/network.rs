use async_trait::async_trait;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use crate::hardware::errors::{HardwareError, HardwareResult};
use super::connection::{Connection, ConnectionType, NetworkProtocol};

pub struct NetworkConnection {
    host: String,
    port: u16,
    protocol: NetworkProtocol,
    timeout_ms: u64,
    tcp_stream: Option<TcpStream>,
    udp_socket: Option<UdpSocket>,
}

impl NetworkConnection {
    pub fn new(
        host: String,
        port: u16,
        protocol: NetworkProtocol,
        timeout_ms: Option<u64>,
    ) -> Self {
        Self {
            host,
            port,
            protocol,
            timeout_ms: timeout_ms.unwrap_or(5000),
            tcp_stream: None,
            udp_socket: None,
        }
    }

    fn address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

#[async_trait]
impl Connection for NetworkConnection {
    async fn connect(&mut self) -> HardwareResult<()> {
        if self.is_connected() {
            return Ok(());
        }

        let address = self.address();
        let timeout = tokio::time::Duration::from_millis(self.timeout_ms);

        match self.protocol {
            NetworkProtocol::Tcp => {
                let connect_future = TcpStream::connect(&address);
                let stream = tokio::time::timeout(timeout, connect_future)
                    .await
                    .map_err(|_| HardwareError::Timeout(format!(
                        "TCP connection timeout to {}",
                        address
                    )))?
                    .map_err(|e| HardwareError::ConnectionError(format!(
                        "Failed to connect to {}: {}",
                        address, e
                    )))?;

                self.tcp_stream = Some(stream);
                tracing::info!("TCP connection established to {}", address);
            }
            NetworkProtocol::Udp => {
                let socket = UdpSocket::bind("0.0.0.0:0")
                    .await
                    .map_err(|e| HardwareError::ConnectionError(format!(
                        "Failed to bind UDP socket: {}",
                        e
                    )))?;

                socket.connect(&address)
                    .await
                    .map_err(|e| HardwareError::ConnectionError(format!(
                        "Failed to connect UDP socket to {}: {}",
                        address, e
                    )))?;

                self.udp_socket = Some(socket);
                tracing::info!("UDP connection established to {}", address);
            }
        }

        Ok(())
    }

    async fn disconnect(&mut self) -> HardwareResult<()> {
        if let Some(mut stream) = self.tcp_stream.take() {
            let _ = stream.shutdown().await;
            tracing::info!("TCP connection closed to {}:{}", self.host, self.port);
        }
        if let Some(_socket) = self.udp_socket.take() {
            tracing::info!("UDP connection closed to {}:{}", self.host, self.port);
        }
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.tcp_stream.is_some() || self.udp_socket.is_some()
    }

    async fn send(&mut self, data: &[u8]) -> HardwareResult<usize> {
        match self.protocol {
            NetworkProtocol::Tcp => {
                let stream = self.tcp_stream.as_mut()
                    .ok_or_else(|| HardwareError::ConnectionError("Not connected".to_string()))?;

                let written = stream.write(data).await?;
                stream.flush().await?;

                tracing::debug!("Sent {} bytes via TCP to {}:{}", written, self.host, self.port);
                Ok(written)
            }
            NetworkProtocol::Udp => {
                let socket = self.udp_socket.as_ref()
                    .ok_or_else(|| HardwareError::ConnectionError("Not connected".to_string()))?;

                let sent = socket.send(data).await?;
                tracing::debug!("Sent {} bytes via UDP to {}:{}", sent, self.host, self.port);
                Ok(sent)
            }
        }
    }

    async fn receive(&mut self, buffer: &mut [u8]) -> HardwareResult<usize> {
        let timeout = tokio::time::Duration::from_millis(self.timeout_ms);

        match self.protocol {
            NetworkProtocol::Tcp => {
                let stream = self.tcp_stream.as_mut()
                    .ok_or_else(|| HardwareError::ConnectionError("Not connected".to_string()))?;

                let read_future = stream.read(buffer);
                match tokio::time::timeout(timeout, read_future).await {
                    Ok(Ok(bytes_read)) => {
                        tracing::debug!("Received {} bytes via TCP from {}:{}", bytes_read, self.host, self.port);
                        Ok(bytes_read)
                    }
                    Ok(Err(e)) => Err(HardwareError::IoError(e)),
                    Err(_) => Err(HardwareError::Timeout(format!(
                        "TCP read timeout from {}:{}",
                        self.host, self.port
                    ))),
                }
            }
            NetworkProtocol::Udp => {
                let socket = self.udp_socket.as_ref()
                    .ok_or_else(|| HardwareError::ConnectionError("Not connected".to_string()))?;

                let recv_future = socket.recv(buffer);
                match tokio::time::timeout(timeout, recv_future).await {
                    Ok(Ok(bytes_read)) => {
                        tracing::debug!("Received {} bytes via UDP from {}:{}", bytes_read, self.host, self.port);
                        Ok(bytes_read)
                    }
                    Ok(Err(e)) => Err(HardwareError::IoError(e)),
                    Err(_) => Err(HardwareError::Timeout(format!(
                        "UDP read timeout from {}:{}",
                        self.host, self.port
                    ))),
                }
            }
        }
    }

    async fn flush(&mut self) -> HardwareResult<()> {
        if let Some(stream) = self.tcp_stream.as_mut() {
            stream.flush().await?;
        }
        // UDP doesn't need flushing
        Ok(())
    }

    fn connection_type(&self) -> ConnectionType {
        ConnectionType::Network
    }

    fn connection_info(&self) -> String {
        let protocol_str = match self.protocol {
            NetworkProtocol::Tcp => "TCP",
            NetworkProtocol::Udp => "UDP",
        };
        format!("{}: {}:{}", protocol_str, self.host, self.port)
    }
}
