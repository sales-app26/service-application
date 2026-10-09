import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CONFIG_NAMESPACE, VISIT_ERROR } from '../../common/constants';
import { IntegrationException } from '../../common/exceptions/business.exception';
import { SupabaseConfig, VisitConfig } from '../../config/configuration';

interface SignedUrlRow {
  path: string | null;
  signedURL: string | null;
  error: string | null;
}

/**
 * Supabase Storage over its REST API, against one **private** bucket.
 *
 * Photos are never public (PRD §5.7): the database stores only the path, and
 * a viewer gets a short-lived signed URL from the API after the API has
 * checked they may see that entry. Nothing deletes a photo that belongs to an
 * entry: for visit photos `removeObjects` only undoes an upload whose entry
 * failed to save, so the bucket never keeps a photo without its entry.
 */
@Injectable()
export class SupabaseStorageClient {
  private readonly logger = new Logger(SupabaseStorageClient.name);
  private readonly config: SupabaseConfig;
  private readonly signedUrlTtlSeconds: number;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<SupabaseConfig>(CONFIG_NAMESPACE.SUPABASE);
    this.signedUrlTtlSeconds = configService.getOrThrow<VisitConfig>(
      CONFIG_NAMESPACE.VISIT,
    ).signedUrlTtlSeconds;
  }

  get bucket(): string {
    return this.config.storageBucket;
  }

  /** Uploads bytes to `path`. Refuses to overwrite: every path is new. */
  async upload(path: string, body: Buffer, contentType: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.objectUrl(path), {
        method: 'POST',
        headers: {
          ...this.serviceHeaders(),
          'Content-Type': contentType,
          'Cache-Control': 'max-age=31536000',
          'x-upsert': 'false',
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(this.config.timeoutMs * 3),
      });
    } catch (error) {
      this.logger.error(`Upload of ${path} failed: ${(error as Error).message}`);
      throw new IntegrationException(VISIT_ERROR.STORAGE_UNAVAILABLE);
    }

    if (!response.ok) {
      this.logger.error(`Upload of ${path} -> ${response.status}: ${await response.text()}`);
      throw new IntegrationException(VISIT_ERROR.STORAGE_UNAVAILABLE);
    }
  }

  /** Removes an upload whose entry failed to save, or a replaced project image. Never throws. */
  async removeObjects(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    try {
      const response = await fetch(`${this.config.url}/storage/v1/object/${this.bucket}`, {
        method: 'DELETE',
        headers: { ...this.serviceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) {
        this.logger.warn(`Orphan cleanup -> ${response.status} for ${paths.join(', ')}`);
      }
    } catch (error) {
      this.logger.warn(
        `Orphan cleanup failed for ${paths.join(', ')}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Short-lived URLs for many paths in one call. A path that cannot be signed
   * maps to null rather than failing the whole list — one missing photo should
   * not blank an admin's timeline.
   */
  async signedUrls(paths: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(paths.filter(Boolean))];
    const result = new Map<string, string | null>();
    if (unique.length === 0) return result;

    try {
      const response = await fetch(`${this.config.url}/storage/v1/object/sign/${this.bucket}`, {
        method: 'POST',
        headers: { ...this.serviceHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: this.signedUrlTtlSeconds, paths: unique }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        this.logger.warn(`Signing ${unique.length} paths -> ${response.status}`);
        unique.forEach((path) => result.set(path, null));
        return result;
      }

      const rows = (await response.json()) as SignedUrlRow[];
      for (const row of rows) {
        if (row.path) {
          result.set(
            row.path,
            row.signedURL ? `${this.config.url}/storage/v1${row.signedURL}` : null,
          );
        }
      }
    } catch (error) {
      this.logger.warn(`Signing photo URLs failed: ${(error as Error).message}`);
    }

    unique.forEach((path) => {
      if (!result.has(path)) result.set(path, null);
    });
    return result;
  }

  async signedUrl(path: string): Promise<string | null> {
    return (await this.signedUrls([path])).get(path) ?? null;
  }

  private objectUrl(path: string): string {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${this.config.url}/storage/v1/object/${this.bucket}/${encoded}`;
  }

  private serviceHeaders(): Record<string, string> {
    return {
      apikey: this.config.serviceRoleKey,
      Authorization: `Bearer ${this.config.serviceRoleKey}`,
    };
  }
}
