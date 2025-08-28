// Client.mts
import * as http from "http";
import * as https from "https";
import { parse as parseUrl } from "url";
import Serializer from "./serializer.mjs";
import Deserializer from "./deserializer.mjs";
import Cookies from "./cookies.mjs";

type HeaderComposer = {
  composeRequest: (headers: http.OutgoingHttpHeaders) => void;
  parseResponse: (headers: http.IncomingHttpHeaders) => void;
};

type BasicAuth = { user: string; pass: string };

export interface ClientOptions extends http.RequestOptions {
  url?: string; // may be used instead of host/port/path
  cookies?: boolean; // enable cookie jar behavior
  basic_auth?: BasicAuth;
  encoding?: BufferEncoding; // request body encoding when serializing
  responseEncoding?: BufferEncoding; // stream.setEncoding for response deserialization
  headers?: http.OutgoingHttpHeaders;
}

export type MethodCallback = (error: any, value?: any) => void;

export default class Client {
  options!: Required<ClientOptions>;
  isSecure!: boolean;
  headersProcessors!: {
    processors: HeaderComposer[];
    composeRequest: (headers: http.OutgoingHttpHeaders) => void;
    parseResponse: (headers: http.IncomingHttpHeaders) => void;
  };
  cookies?: Cookies;

  constructor(options: ClientOptions | string, isSecure = false) {
    // Allow calling without `new`
    // (keeping original API shape; TS classes require `new`, but we mimic by returning a new instance)
    if (!(this instanceof Client)) {
      return new Client(options, isSecure);
    }

    // Normalize options
    let opts: ClientOptions =
      typeof options === "string" ? ((): ClientOptions => {
        const parsed = parseUrl(options);
        return {
          host: (parsed as any).hostname,
          path: parsed.pathname ?? undefined,
          port: parsed.port ? Number(parsed.port) : undefined,
        };
      })() : { ...options };

    if (typeof opts.url !== "undefined") {
      const parsedUrl = parseUrl(opts.url);
      opts.host = (parsedUrl as any).hostname ?? opts.host;
      opts.path = parsedUrl.pathname ?? opts.path;
      if (parsedUrl.port) opts.port = Number(parsedUrl.port);
    }

    // Default headers
    const defaultHeaders: http.OutgoingHttpHeaders = {
      "User-Agent": "NodeJS XML-RPC Client",
      "Content-Type": "text/xml",
      Accept: "text/xml",
      "Accept-Charset": "UTF8",
      Connection: "Keep-Alive",
    };
    opts.headers = opts.headers ?? {};

    // Basic auth header
    if (
      opts.headers.Authorization == null &&
      opts.basic_auth?.user != null &&
      opts.basic_auth?.pass != null
    ) {
      const auth = `${opts.basic_auth.user}:${opts.basic_auth.pass}`;
      (opts.headers as any)["Authorization"] =
        "Basic " + Buffer.from(auth).toString("base64");
    }

    for (const k of Object.keys(defaultHeaders)) {
      if (opts.headers[k] === undefined) {
        opts.headers[k] = defaultHeaders[k];
      }
    }

    // Ensure method
    opts.method = "POST";

    // Fill some optional defaults for strong typing
    const finalized: Required<ClientOptions> = {
      ...opts,
      _defaultAgent: opts._defaultAgent!!,
      defaultPort: opts.defaultPort!!,
      family: opts.family ?? 0,
      hints: opts.hints ?? 0,
      insecureHTTPParser: opts.insecureHTTPParser!!,
      localPort: opts.localPort!!,
      lookup: opts.lookup!!,
      setDefaultHeaders: opts.setDefaultHeaders!!,
      socketPath: opts.socketPath!!,
      uniqueHeaders: opts.uniqueHeaders!!,
      joinDuplicateHeaders: opts.joinDuplicateHeaders!!,
      // Provide defaults for optional fields to satisfy Required<>
      headers: opts.headers!,
      method: opts.method ?? "POST",
      protocol: (opts.protocol as any) ?? undefined,
      auth: (opts.auth as any) ?? undefined,
      agent: (opts.agent as any) ?? undefined,
      timeout: (opts.timeout as any) ?? undefined,
      localAddress: (opts.localAddress as any) ?? undefined,
      createConnection: (opts.createConnection as any) ?? undefined,
      setHost: (opts.setHost as any) ?? undefined,
      maxHeaderSize: (opts.maxHeaderSize as any) ?? undefined,
      signal: (opts.signal as any) ?? undefined,
      // Custom fields:
      url: opts.url!!,
      cookies: opts.cookies ?? false,
      basic_auth: opts.basic_auth!!,
      encoding: opts.encoding ?? "utf8",
      responseEncoding: opts.responseEncoding!!,
      // Keep other RequestOptions fields if present
      host: opts.host as any,
      hostname: (opts as any).hostname,
      port: opts.port as any,
      path: opts.path as any,
    };

    this.options = finalized;
    this.isSecure = isSecure;

    this.headersProcessors = {
      processors: [],
      composeRequest: function (headers: http.OutgoingHttpHeaders) {
        this.processors.forEach((p) => p.composeRequest(headers));
      },
      parseResponse: function (headers: http.IncomingHttpHeaders) {
        this.processors.forEach((p) => p.parseResponse(headers));
      },
    };

    if (finalized.cookies) {
      this.cookies = new (Cookies as any)();
      this.headersProcessors.processors.unshift(this.cookies as unknown as HeaderComposer);
    }
  }

  /**
   * Makes an XML-RPC call to the server specified by the constructor's options.
   *
   * @param method The method name.
   * @param params Params to send in the call.
   * @param callback function(error, value) { ... }
   */
  methodCall(method: string, params: any[], callback: MethodCallback): void {
    const options = this.options;
    const xml = Serializer.serializeMethodCall(method, params, options.encoding);
    const transport = this.isSecure ? https : http;

    options.headers["Content-Length"] = Buffer.byteLength(xml, "utf8");
    this.headersProcessors.composeRequest(options.headers);

    const request = transport.request(options, (response) => {
      const body: Buffer[] = [];
      response.on("data", (chunk) => {
        body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      });

      const __enrichError = (err: any) => {
        // mirror original non-enumerable properties
        Object.defineProperty(err, "req", { value: request });
        Object.defineProperty(err, "res", { value: response });
        Object.defineProperty(err, "body", { value: Buffer.concat(body).toString() });
        return err;
      };

      if (response.statusCode === 404) {
        callback(__enrichError(new Error("Not Found")));
      } else {
        this.headersProcessors.parseResponse(response.headers);

        console.log({ response: JSON.stringify(response, null, 2) });

        const deserializer = new Deserializer(options.responseEncoding);

        deserializer.deserializeMethodResponse(response, (err: any, result: any) => {
          if (err) err = __enrichError(err);
          callback(err, result);
        });
      }
    });

    request.on("error", callback);
    request.write(xml, "utf8");
    request.end();
  }

  /**
   * Gets the cookie value by its name.
   * Throws if cookies were not enabled on this client.
   */
  getCookie(name: string): any {
    if (!this.cookies) {
      throw new Error("Cookies support is not turned on for this client instance");
    }
    return (this.cookies as any).get(name);
  }

  /**
   * Sets the cookie value by its name (sent on the next XML-RPC call).
   * Chainable.
   */
  setCookie(name: string, value: string): this {
    if (!this.cookies) {
      throw new Error("Cookies support is not turned on for this client instance");
    }
    (this.cookies as any).set(name, value);
    return this;
  }
}
