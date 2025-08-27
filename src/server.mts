// server.mts
import * as http from "http";
import * as https from "https";
import { parse as parseUrl } from "url";
import { EventEmitter } from "events";
import Serializer from "./serializer.mjs";
import Deserializer from "./deserializer.mjs";

type OnListening = () => void;

export interface ServerInitOptions {
  host?: string;
  port: number;
  // You may add HTTPS options here if you pass an HTTPS serverOptions object
  // (e.g., key/cert) when using isSecure = true.
  // We leave this open to allow passing through to https.createServer:
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * XML-RPC Server that listens for method calls and emits events with the method name.
 *
 * Usage:
 *   const srv = new Server({ host: "127.0.0.1", port: 9090 }, false, () => {
 *     console.log("listening");
 *   });
 *   srv.on("sum", (err, params, reply) => { reply(null, params[0] + params[1]); });
 */
export default class Server extends EventEmitter {
  public httpServer: http.Server | https.Server;

  constructor(
    options: ServerInitOptions | string,
    isSecure: boolean = false,
    onListening?: OnListening
  ) {
    super();

    const listenCb: OnListening = onListening ?? (() => { });

    // Normalize options when given a URL string
    let opts: ServerInitOptions;
    if (typeof options === "string") {
      const parsed = parseUrl(options);
      opts = {
        host: (parsed as any).hostname,
        // pathname can be used by upstream stacks; keep parity with original assignment
        path: parsed.pathname,
        port: parsed.port ? Number(parsed.port) : undefined,
      } as ServerInitOptions;
    } else {
      opts = { ...options };
    }

    // request handler for XML-RPC method calls
    const handleMethodCall = (request: http.IncomingMessage, response: http.ServerResponse) => {
      const deserializer = new Deserializer();
      deserializer.deserializeMethodCall(
        request,
        (error: Error | null, methodName?: string, params?: any[]) => {
          if (methodName && this.listenerCount(methodName) > 0) {
            // The handler signature mirrors the original:
            // listener(null, params, (error, value) => { ... })
            this.emit(
              methodName,
              null,
              params,
              (err: any, value: any) => {
                const xml =
                  err != null
                    ? Serializer.serializeFault(err)
                    : Serializer.serializeMethodResponse(value);

                response.writeHead(200, { "Content-Type": "text/xml" });
                response.end(xml);
              }
            );
          } else {
            this.emit("NotFound", methodName, params);
            response.writeHead(404);
            response.end();
          }
        }
      );
    };

    // Create HTTP/HTTPS server
    this.httpServer = isSecure
      ? https.createServer(opts as https.ServerOptions, handleMethodCall)
      : http.createServer(handleMethodCall);

    // Begin listening on next tick (parity with original)
    process.nextTick(() => {
      this.httpServer.listen(opts.port, opts.host, listenCb);
    });
  }

  /**
   * Closes the underlying server. The callback is invoked after 'close'.
   */
  close(callback: () => void): void {
    this.httpServer.once("close", callback);
    this.httpServer.close();
  }
}
