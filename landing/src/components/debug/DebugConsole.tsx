'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface LogEntry {
  id: number;
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  time: string;
}

const COLORS: Record<string, string> = {
  log: '#e2e8f0',
  info: '#93c5fd',
  warn: '#fcd34d',
  error: '#fca5a5',
};

const BG_COLORS: Record<string, string> = {
  log: 'transparent',
  info: 'rgba(59,130,246,0.1)',
  warn: 'rgba(234,179,8,0.1)',
  error: 'rgba(239,68,68,0.15)',
};

let globalLogId = 0;
const globalLogs: LogEntry[] = [];
let globalListener: (() => void) | null = null;

function addLog(level: LogEntry['level'], args: any[]) {
  try {
    const message = args
      .map((a) => {
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
        if (typeof a === 'object') {
          try { return JSON.stringify(a, null, 2); } catch { return String(a); }
        }
        return String(a);
      })
      .join(' ');

    globalLogs.push({
      id: globalLogId++,
      level,
      message,
      time: new Date().toLocaleTimeString('tr-TR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });

    if (globalLogs.length > 200) globalLogs.shift();
    globalListener?.();
  } catch {}
}

// Intercept console methods ONCE at module level
if (typeof window !== 'undefined') {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const origInfo = console.info;

  console.log = (...args: any[]) => { origLog.apply(console, args); addLog('log', args); };
  console.warn = (...args: any[]) => { origWarn.apply(console, args); addLog('warn', args); };
  console.error = (...args: any[]) => { origError.apply(console, args); addLog('error', args); };
  console.info = (...args: any[]) => { origInfo.apply(console, args); addLog('info', args); };

  window.addEventListener('error', (e) => {
    addLog('error', [`[Uncaught] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`]);
  });

  window.addEventListener('unhandledrejection', (e) => {
    addLog('error', [`[UnhandledPromise] ${e.reason}`]);
  });
}

// Shake detection
function useShakeDetection(onShake: () => void) {
  const lastShake = useRef(0);
  const shakeCount = useRef(0);
  const lastAccel = useRef({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    const THRESHOLD = 25;
    const SHAKE_WINDOW = 1500;
    const SHAKES_NEEDED = 3;

    function handleMotion(e: DeviceMotionEvent) {
      const accel = e.accelerationIncludingGravity;
      if (!accel?.x || !accel?.y || !accel?.z) return;

      const deltaX = Math.abs(accel.x - lastAccel.current.x);
      const deltaY = Math.abs(accel.y - lastAccel.current.y);
      const deltaZ = Math.abs(accel.z - lastAccel.current.z);

      lastAccel.current = { x: accel.x, y: accel.y, z: accel.z };

      if (deltaX + deltaY + deltaZ > THRESHOLD) {
        const now = Date.now();
        if (now - lastShake.current < SHAKE_WINDOW) {
          shakeCount.current++;
        } else {
          shakeCount.current = 1;
        }
        lastShake.current = now;

        if (shakeCount.current >= SHAKES_NEEDED) {
          shakeCount.current = 0;
          onShake();
        }
      }
    }

    // iOS 13+ requires permission
    const requestPermission = async () => {
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        try {
          const permission = await (DeviceMotionEvent as any).requestPermission();
          if (permission === 'granted') {
            window.addEventListener('devicemotion', handleMotion);
          }
        } catch {}
      } else {
        window.addEventListener('devicemotion', handleMotion);
      }
    };

    requestPermission();

    // Fallback: also listen for 5 rapid taps anywhere on screen
    let tapCount = 0;
    let tapTimer: ReturnType<typeof setTimeout>;
    function handleTouch() {
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 2000);
      if (tapCount >= 7) {
        tapCount = 0;
        onShake();
      }
    }
    window.addEventListener('touchstart', handleTouch, { passive: true });

    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      window.removeEventListener('touchstart', handleTouch);
    };
  }, [onShake]);
}

export default function DebugConsole() {
  const [visible, setVisible] = useState(false);
  const [, forceUpdate] = useState(0);
  const [mounted, setMounted] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    globalListener = () => forceUpdate((n) => n + 1);
    return () => { globalListener = null; };
  }, []);

  useEffect(() => {
    if (visible && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [visible, globalLogs.length]);

  const toggle = useCallback(() => {
    setVisible((v) => {
      const next = !v;
      if (next) {
        try { navigator.vibrate?.(50); } catch {}
      }
      return next;
    });
  }, []);

  useShakeDetection(toggle);

  if (!mounted) return null;

  const panel = (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: visible ? '45vh' : 0,
        zIndex: 99999,
        backgroundColor: '#0f172a',
        borderTop: visible ? '2px solid #f97316' : 'none',
        transition: 'height 0.3s ease',
        overflow: 'hidden',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          backgroundColor: '#1e293b',
          borderBottom: '1px solid #334155',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#f97316', fontWeight: 700, fontSize: '12px' }}>
          Debug Console ({globalLogs.length})
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => { globalLogs.length = 0; forceUpdate((n) => n + 1); }}
            style={{
              color: '#94a3b8',
              background: 'none',
              border: '1px solid #475569',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
          <button
            onClick={() => setVisible(false)}
            style={{
              color: '#f87171',
              background: 'none',
              border: '1px solid #475569',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Logs */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 0',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {globalLogs.length === 0 && (
          <div style={{ color: '#64748b', padding: '12px', textAlign: 'center' }}>
            No logs yet. Shake device to toggle.
          </div>
        )}
        {globalLogs.map((log) => (
          <div
            key={log.id}
            style={{
              padding: '3px 12px',
              borderBottom: '1px solid #1e293b',
              backgroundColor: BG_COLORS[log.level],
              color: COLORS[log.level],
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              lineHeight: '1.4',
            }}
          >
            <span style={{ color: '#64748b', marginRight: '6px' }}>{log.time}</span>
            <span
              style={{
                color: COLORS[log.level],
                fontWeight: log.level === 'error' ? 700 : 400,
                marginRight: '6px',
                textTransform: 'uppercase',
                fontSize: '9px',
              }}
            >
              [{log.level}]
            </span>
            {log.message}
          </div>
        ))}
      </div>
    </div>
  );

  // Floating indicator when console has errors but is closed
  const errorCount = globalLogs.filter((l) => l.level === 'error').length;
  const indicator =
    !visible && errorCount > 0 ? (
      <div
        onClick={toggle}
        style={{
          position: 'fixed',
          bottom: '12px',
          right: '12px',
          zIndex: 99998,
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          backgroundColor: '#ef4444',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 700,
          fontFamily: 'ui-monospace, monospace',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        {errorCount}
      </div>
    ) : null;

  return createPortal(
    <>
      {panel}
      {indicator}
    </>,
    document.body,
  );
}
