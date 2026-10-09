import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

/** The response envelope, success or failure. */
export interface ApiResult<T = any> {
  status: number;
  body: {
    success: boolean;
    message: string;
    data: T;
    errorCode?: string;
    details?: Record<string, unknown>;
    errors?: Array<{ field: string; messages: string[] }>;
  };
  headers: Headers;
  text: string;
}

export type FormFields = Record<string, string | number | undefined>;

/** A thin fetch wrapper that speaks the API's envelope. */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  as(token: string): ApiClient {
    return new ApiClient(this.baseUrl, token);
  }

  get<T = any>(path: string): Promise<ApiResult<T>> {
    return this.request('GET', path);
  }

  post<T = any>(path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.request('POST', path, body);
  }

  patch<T = any>(path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.request('PATCH', path, body);
  }

  delete<T = any>(path: string): Promise<ApiResult<T>> {
    return this.request('DELETE', path);
  }

  /** multipart/form-data with an optional photo part. */
  postForm<T = any>(
    path: string,
    fields: FormFields,
    photo?: Buffer,
    field = 'photo',
  ): Promise<ApiResult<T>> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) form.append(key, String(value));
    }
    if (photo) {
      form.append(field, new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'camera.jpg');
    }
    return this.send('POST', path, form);
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.send(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
      body !== undefined,
    );
  }

  private async send<T>(
    method: string,
    path: string,
    body?: string | FormData,
    isJson = false,
  ): Promise<ApiResult<T>> {
    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
    const text = await response.text();
    let parsed: ApiResult<T>['body'];
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { success: response.ok, message: '', data: text as T };
    }
    return { status: response.status, body: parsed, headers: response.headers, text };
  }
}

export const requestId = (): string => randomUUID();

/** A small real JPEG standing in for the camera. */
export const cameraJpeg = (): Promise<Buffer> =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 160, b: 90 } } })
    .jpeg({ quality: 85 })
    .toBuffer();
