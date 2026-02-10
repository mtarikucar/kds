import { useState } from 'react';

type AuthMethod = 'password' | 'privateKey';

export interface SshConnectionData {
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

interface SshConnectionFormProps {
  onConnect: (data: SshConnectionData) => void;
  isConnecting: boolean;
}

export default function SshConnectionForm({
  onConnect,
  isConnecting,
}: SshConnectionFormProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const data: SshConnectionData = {
      host,
      port,
      username,
      authMethod,
    };

    if (authMethod === 'password') {
      data.password = password;
    } else {
      data.privateKey = privateKey;
      if (passphrase) {
        data.passphrase = passphrase;
      }
    }

    onConnect(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Host */}
        <div className="sm:col-span-2">
          <label
            htmlFor="ssh-host"
            className="block text-sm font-medium text-zinc-700 mb-1"
          >
            Host
          </label>
          <input
            id="ssh-host"
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.100 or example.com"
            required
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent bg-white"
          />
        </div>

        {/* Port */}
        <div>
          <label
            htmlFor="ssh-port"
            className="block text-sm font-medium text-zinc-700 mb-1"
          >
            Port
          </label>
          <input
            id="ssh-port"
            type="number"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value, 10) || 22)}
            min={1}
            max={65535}
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent bg-white"
          />
        </div>
      </div>

      {/* Username */}
      <div>
        <label
          htmlFor="ssh-username"
          className="block text-sm font-medium text-zinc-700 mb-1"
        >
          Username
        </label>
        <input
          id="ssh-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="root"
          required
          className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent bg-white"
        />
      </div>

      {/* Auth Method Toggle */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-2">
          Authentication
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAuthMethod('password')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              authMethod === 'password'
                ? 'bg-zinc-900 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => setAuthMethod('privateKey')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              authMethod === 'privateKey'
                ? 'bg-zinc-900 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            Private Key
          </button>
        </div>
      </div>

      {/* Conditional Auth Fields */}
      {authMethod === 'password' ? (
        <div>
          <label
            htmlFor="ssh-password"
            className="block text-sm font-medium text-zinc-700 mb-1"
          >
            Password
          </label>
          <input
            id="ssh-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent bg-white"
          />
        </div>
      ) : (
        <>
          <div>
            <label
              htmlFor="ssh-private-key"
              className="block text-sm font-medium text-zinc-700 mb-1"
            >
              Private Key
            </label>
            <textarea
              id="ssh-private-key"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              required
              rows={4}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent bg-white font-mono resize-none"
            />
          </div>
          <div>
            <label
              htmlFor="ssh-passphrase"
              className="block text-sm font-medium text-zinc-700 mb-1"
            >
              Passphrase{' '}
              <span className="text-zinc-400 font-normal">(optional)</span>
            </label>
            <input
              id="ssh-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent bg-white"
            />
          </div>
        </>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isConnecting}
        className="w-full px-4 py-2.5 bg-zinc-900 text-white text-sm font-medium rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isConnecting ? 'Connecting...' : 'Connect'}
      </button>
    </form>
  );
}
