import { ConfigService } from '@nestjs/config';

import { CONFIG_NAMESPACE, ERROR_CODE, VISIT_ERROR } from '../../common/constants';
import { VisitConfig } from '../../config/configuration';
import { CaptureTokenService } from './capture-token.service';

const config = {
  getOrThrow: (key: string) =>
    key === CONFIG_NAMESPACE.VISIT
      ? ({
          captureTokenSecret: 'a-test-secret-that-is-at-least-32-characters',
          captureWindowMinutes: 10,
          signedUrlTtlSeconds: 600,
        } satisfies VisitConfig)
      : undefined,
} as unknown as ConfigService;

const MINUTE = 60_000;

describe('CaptureTokenService (PRD §5.7: submit within 10 minutes)', () => {
  const service = new CaptureTokenService(config);
  const issuedAt = new Date('2026-10-08T10:00:00Z');
  const { captureToken } = service.issue('user-1', issuedAt);

  it('accepts the token inside the window', () => {
    expect(() =>
      service.verify(captureToken, 'user-1', new Date(issuedAt.getTime() + 9 * MINUTE)),
    ).not.toThrow();
  });

  it('refuses it after 10 minutes — the photo must be retaken', () => {
    expect(() =>
      service.verify(captureToken, 'user-1', new Date(issuedAt.getTime() + 10 * MINUTE + 1)),
    ).toThrow(expect.objectContaining({ errorCode: ERROR_CODE.CAPTURE_EXPIRED }));
  });

  it('is useless to anyone else', () => {
    expect(() => service.verify(captureToken, 'user-2', issuedAt)).toThrow(
      VISIT_ERROR.CAPTURE_INVALID,
    );
  });

  it('refuses a token whose time was tampered with', () => {
    const [version, , signature] = captureToken.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'user-1', i: Date.now() })).toString(
      'base64url',
    );
    expect(() => service.verify(`${version}.${forged}.${signature}`, 'user-1')).toThrow(
      VISIT_ERROR.CAPTURE_INVALID,
    );
  });

  it('requires a token at all', () => {
    expect(() => service.verify(undefined, 'user-1')).toThrow(
      expect.objectContaining({ errorCode: ERROR_CODE.VISIT_PROOF_REQUIRED }),
    );
  });
});
