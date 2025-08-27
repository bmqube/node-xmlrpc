// index.mts
import Client, { type ClientOptions } from "./client.mjs";
import Server, { type ServerInitOptions } from "./server.mjs";
import CustomType from "./customtype.mjs";
import dateFormatter, { DateFormatter as DateFormatterClass } from "./date_formatter.mjs";

/**
 * Creates an XML-RPC client (HTTP).
 */
export function createClient(options: ClientOptions): Client {
  return new Client(options, false);
}

/**
 * Creates an XML-RPC client (HTTPS).
 */
export function createSecureClient(options: ClientOptions): Client {
  return new Client(options, true);
}

/**
 * Creates an XML-RPC server (HTTP).
 */
export function createServer(
  options: ServerInitOptions,
  callback?: () => void
): Server {
  return new Server(options, false, callback);
}

/**
 * Creates an XML-RPC server (HTTPS).
 */
export function createSecureServer(
  options: ServerInitOptions,
  callback?: () => void
): Server {
  return new Server(options, true, callback);
}

// Re-exports for convenience
export { Client, Server, CustomType, dateFormatter, DateFormatterClass as DateFormatter };

// Default export mirroring the original CommonJS `xmlrpc` object
export default {
  createClient,
  createSecureClient,
  createServer,
  createSecureServer,
  CustomType,
  dateFormatter,
};
