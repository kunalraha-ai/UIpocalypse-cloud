import { describe, expect, it } from 'vitest';
import { newSessionId, signSessionId, verifySignedSession } from '../src/lib/auth/session.ts';

/**
 * Session cookie contract: HMAC-signed, constant-time verified, tamper-proof.
 * The cookie must fail closed — any modification yields null, never an error.
 */

describe('session signing', () => {
  it('round-trips a signed session id', () => {
    const id = newSessionId();
    const signed = signSessionId(id, 'secret');
    expect(verifySignedSession(signed, 'secret')).toBe(id);
  });

  it('rejects a wrong secret', () => {
    const signed = signSessionId(newSessionId(), 'secret');
    expect(verifySignedSession(signed, 'other-secret')).toBeNull();
  });

  it('rejects tampering (id or mac modified)', () => {
    const id = newSessionId();
    const signed = signSessionId(id, 'secret');
    const tamperedId = signSessionId(newSessionId(), 'secret');
    expect(verifySignedSession(`${tamperedId.slice(0, 64)}${signed.slice(64)}`, 'secret')).toBeNull();
    expect(verifySignedSession(`${id}.AAAA${signed.slice(-4)}`, 'secret')).toBeNull();
  });

  it('rejects malformed cookies without throwing', () => {
    expect(verifySignedSession('', 'secret')).toBeNull();
    expect(verifySignedSession('nodots', 'secret')).toBeNull();
    expect(verifySignedSession('a.b.c', 'secret')).toBeNull();
  });

  it('session ids are 256-bit random', () => {
    expect(newSessionId()).toHaveLength(64);
    expect(newSessionId()).not.toBe(newSessionId());
  });
});
