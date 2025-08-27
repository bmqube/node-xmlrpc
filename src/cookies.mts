// cookies.mts
import type * as http from "http";

type CookieRecord = {
  value: string;
  expires?: Date;
  secure?: boolean;
  /** preserved from original; not used in logic */
  new?: boolean;
};

export default class Cookies {
  private cookies: Record<string, CookieRecord>;

  constructor() {
    this.cookies = {};
  }

  /**
   * Obtains value of the cookie with specified name.
   * Checks expiration and returns null for expired/nonexistent cookies.
   */
  get(name: string): string | null {
    const cookie = this.cookies[name];
    if (cookie && this.checkNotExpired(name)) {
      return this.cookies[name].value;
    }
    return null;
  }

  /**
   * Sets a cookie's value with optional attributes.
   */
  set(
    name: string,
    value: string,
    options?: { secure?: boolean; expires?: Date; new?: boolean }
  ): void {
    const cookie: CookieRecord =
      typeof options === "object"
        ? {
          value,
          expires: options.expires,
          secure: options.secure ?? false,
          new: options.new ?? false,
        }
        : { value };

    if (this.checkNotExpired(name, cookie)) {
      this.cookies[name] = cookie;
    }
  }

  /** For testing / inspection */
  getExpirationDate(name: string): Date | null {
    return this.cookies[name] ? this.cookies[name].expires ?? null : null;
  }

  /**
   * Internal helper: true if cookie is not expired. Deletes expired entries.
   */
  private checkNotExpired(name: string, cookie?: CookieRecord): boolean {
    const c = cookie ?? this.cookies[name];
    if (!c) return false;

    const now = new Date();
    if (c.expires && now > c.expires) {
      delete this.cookies[name];
      return false;
    }
    return true;
  }

  /**
   * Parses response headers, collecting Set-Cookie values.
   * Only the Expires attribute is honored (parity with original).
   */
  parseResponse(headers: http.IncomingHttpHeaders): void {
    const setCookie = headers["set-cookie"];
    if (!setCookie) return;

    const list = Array.isArray(setCookie) ? setCookie : [setCookie];

    list.forEach((c) => {
      if (!c) return;

      const parts = c.split(";");
      const nameValue = parts.shift();
      if (!nameValue) return;

      const eqIdx = nameValue.indexOf("=");
      const name =
        eqIdx >= 0 ? nameValue.slice(0, eqIdx).trim() : nameValue.trim();
      const value = eqIdx >= 0 ? nameValue.slice(eqIdx + 1).trim() : "";

      const options: { expires?: Date } = {};

      parts.forEach((param) => {
        const p = param.trim();
        if (p.toLowerCase().startsWith("expires")) {
          const eq = p.indexOf("=");
          if (eq >= 0) {
            const dateStr = p.slice(eq + 1).trim();
            const d = new Date(dateStr);
            if (!Number.isNaN(d.getTime())) {
              options.expires = d;
            }
          }
        }
      });

      this.set(name, value, options);
    });
  }

  /**
   * Adds cookies to outgoing request headers (as a single "Cookie" header).
   * Skips if there are no (non-expired) cookies.
   */
  composeRequest(headers: http.OutgoingHttpHeaders): void {
    const asString = this.toString();
    if (!asString) return;
    headers["Cookie"] = asString;
  }

  /**
   * Returns cookies formatted as "name=value" pairs joined by semicolons.
   * Filters out expired cookies on the fly.
   */
  toString(): string {
    const names = Object.keys(this.cookies).filter((n) =>
      this.checkNotExpired(n)
    );
    if (names.length === 0) return "";
    return names
      .map((name) => `${name}=${this.cookies[name].value}`)
      .join(";");
  }
}
