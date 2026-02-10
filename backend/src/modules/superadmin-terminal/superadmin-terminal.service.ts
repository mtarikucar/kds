import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, ClientChannel } from 'ssh2';
import { SshConnectDto, AuthMethod } from './dto';

interface SshSession {
  client: Client;
  stream: ClientChannel;
  superAdminId: string;
  host: string;
  idleTimer: NodeJS.Timeout;
}

@Injectable()
export class SuperAdminTerminalService implements OnModuleDestroy {
  private readonly logger = new Logger(SuperAdminTerminalService.name);
  private readonly sessions = new Map<string, SshSession>();
  private readonly idleTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.idleTimeoutMs = parseInt(
      this.configService.get<string>('SSH_IDLE_TIMEOUT_MS', '1800000'),
      10,
    );
  }

  async connect(
    socketId: string,
    superAdminId: string,
    dto: SshConnectDto,
    onData: (data: string) => void,
    onClose: (reason?: string) => void,
  ): Promise<void> {
    if (this.sessions.has(socketId)) {
      this.disconnect(socketId);
    }

    return new Promise((resolve, reject) => {
      const client = new Client();

      const connectConfig: Record<string, unknown> = {
        host: dto.host,
        port: dto.port ?? 22,
        username: dto.username,
        readyTimeout: 15000,
      };

      if (dto.authMethod === AuthMethod.PASSWORD) {
        connectConfig.password = dto.password;
      } else {
        connectConfig.privateKey = dto.privateKey;
        if (dto.passphrase) {
          connectConfig.passphrase = dto.passphrase;
        }
      }

      client.on('ready', () => {
        this.logger.log(
          `SSH connection established: ${dto.username}@${dto.host}:${dto.port ?? 22} (socket: ${socketId})`,
        );

        client.shell(
          { term: 'xterm-256color', cols: 80, rows: 24 },
          (err, stream) => {
            if (err) {
              client.end();
              reject(new Error(`Failed to open shell: ${err.message}`));
              return;
            }

            const idleTimer = this.createIdleTimer(socketId, onClose);

            this.sessions.set(socketId, {
              client,
              stream,
              superAdminId,
              host: dto.host,
              idleTimer,
            });

            stream.on('data', (data: Buffer) => {
              onData(data.toString('utf-8'));
            });

            stream.on('close', () => {
              this.logger.log(`SSH stream closed for socket: ${socketId}`);
              this.cleanupSession(socketId);
              onClose('SSH session closed');
            });

            stream.stderr.on('data', (data: Buffer) => {
              onData(data.toString('utf-8'));
            });

            resolve();
          },
        );
      });

      client.on('error', (err) => {
        this.logger.error(
          `SSH connection error for socket ${socketId}: ${err.message}`,
        );
        this.cleanupSession(socketId);
        reject(new Error(`SSH connection failed: ${err.message}`));
      });

      client.on('end', () => {
        this.logger.log(`SSH connection ended for socket: ${socketId}`);
        this.cleanupSession(socketId);
      });

      client.connect(connectConfig);
    });
  }

  write(socketId: string, data: string): void {
    const session = this.sessions.get(socketId);
    if (!session) {
      return;
    }

    session.stream.write(data);
    this.resetIdleTimer(socketId);
  }

  resize(socketId: string, cols: number, rows: number): void {
    const session = this.sessions.get(socketId);
    if (!session) {
      return;
    }

    session.stream.setWindow(rows, cols, 0, 0);
  }

  disconnect(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (!session) {
      return;
    }

    this.logger.log(
      `Disconnecting SSH session for socket: ${socketId} (host: ${session.host})`,
    );

    try {
      session.stream.close();
    } catch {
      // Stream may already be closed
    }

    try {
      session.client.end();
    } catch {
      // Client may already be closed
    }

    this.cleanupSession(socketId);
  }

  onModuleDestroy(): void {
    this.disconnectAll();
  }

  private disconnectAll(): void {
    this.logger.log(
      `Disconnecting all SSH sessions (count: ${this.sessions.size})`,
    );

    for (const socketId of this.sessions.keys()) {
      this.disconnect(socketId);
    }
  }

  private cleanupSession(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (session) {
      clearTimeout(session.idleTimer);
      this.sessions.delete(socketId);
    }
  }

  private createIdleTimer(
    socketId: string,
    onClose: (reason?: string) => void,
  ): NodeJS.Timeout {
    return setTimeout(() => {
      this.logger.warn(`SSH session idle timeout for socket: ${socketId}`);
      this.disconnect(socketId);
      onClose('Idle timeout - session closed after inactivity');
    }, this.idleTimeoutMs);
  }

  private resetIdleTimer(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (!session) {
      return;
    }

    clearTimeout(session.idleTimer);
    session.idleTimer = this.createIdleTimer(socketId, () => {
      // onClose callback for idle timer reset
    });
  }
}
