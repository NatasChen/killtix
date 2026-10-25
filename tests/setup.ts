// Tests must never reach external services (e-mail, Telegram, Teams, Resend): use fake senders or vi.stubGlobal('fetch').
// Real fetch calls and non-loopback socket connections are recorded and fail the test afterwards, even when the
// code under test catches the error (dispatchPending does).
import dns from 'node:dns';
import net from 'node:net';
import { afterEach } from 'vitest';

const attempts: string[] = [];
const LOOPBACK = new Set([undefined, 'localhost', '127.0.0.1', '::1']); // the test PostgreSQL runs on loopback

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = input instanceof Request ? input.url : String(input);
  attempts.push(`fetch ${url}`);
  throw new Error(`network access blocked in tests: ${url}`);
}) as typeof fetch;

const connect = net.Socket.prototype.connect as (...args: unknown[]) => net.Socket;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  // net.connect() passes its normalized arguments as one array: [options, callback]
  const [first, second] = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  const host = typeof first === 'object' && first !== null ? (first as net.TcpNetConnectOpts).host : typeof first === 'number' ? (second as string | undefined) : undefined;
  if (!LOOPBACK.has(host ?? undefined)) {
    attempts.push(`connect ${host}`);
    throw new Error(`network access blocked in tests: ${host}`);
  }
  return connect.apply(this, args);
} as typeof net.Socket.prototype.connect;

// Host names are resolved before connecting (nodemailer uses these), so block the lookup as well.
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6'] as const) {
  const original = dns[name] as (...args: unknown[]) => unknown;
  (dns as unknown as Record<string, unknown>)[name] = (host: string, ...rest: unknown[]) => {
    if (LOOPBACK.has(host)) return original(host, ...rest);
    attempts.push(`dns ${host}`);
    const callback = rest.at(-1) as (err: Error) => void;
    process.nextTick(() => callback(Object.assign(new Error(`network access blocked in tests: ${host}`), { code: 'ENOTFOUND' })));
  };
}

afterEach(() => {
  if (attempts.length) {
    const list = attempts.splice(0).join(', ');
    throw new Error(`test tried to reach an external service (${list}); use fake senders or vi.stubGlobal('fetch')`);
  }
});
