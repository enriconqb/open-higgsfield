declare module "@tus/server" {
  export class Server {
    constructor(options: Record<string, unknown>);
    handleWeb(request: Request): Promise<Response>;
  }
}

declare module "@tus/file-store" {
  export class FileStore {
    constructor(options: { directory: string; expirationPeriodInMilliseconds?: number });
  }
}

declare module "tus-js-client" {
  export class Upload {
    constructor(
      file: Blob,
      options: {
        endpoint: string;
        chunkSize?: number;
        retryDelays?: number[];
        metadata?: Record<string, string>;
        onError?: (error: Error) => void;
        onSuccess?: () => void;
        onAfterResponse?: (request: unknown, response: { getHeader: (name: string) => string | null }) => void;
      },
    );
    start(): void;
  }
}
