// date_formatter.mts

export interface DateFormatterOptions {
  colons: boolean;
  hyphens: boolean;
  local: boolean;
  ms: boolean;
  offset: boolean;
}

/**
 * @class DateFormatter
 * The DateFormatter supports decoding from and encoding to
 * ISO8601 formatted strings. Accepts formats with and without
 * hyphen/colon separators and correctly parses zoning info.
 */
export class DateFormatter {
  opts: DateFormatterOptions;

  constructor(opts?: Partial<DateFormatterOptions>) {
    this.opts = { ...DateFormatter.DEFAULT_OPTIONS };
    this.setOpts(opts);
  }

  /**
   * Default options for DateFormatter
   */
  static readonly DEFAULT_OPTIONS: DateFormatterOptions = {
    colons: true,
    hyphens: false,
    local: true,
    ms: false,
    offset: false,
  };

  /**
   * Regular Expression that dissects ISO 8601 formatted strings into parts.
   */
  static readonly ISO8601 = new RegExp(
    "([0-9]{4})([-]?([0-9]{2}))([-]?([0-9]{2}))" +
    "(T([0-9]{2})(((:?([0-9]{2}))?((:?([0-9]{2}))?(\\.([0-9]+))?))?)" +
    "(Z|([+-]([0-9]{2}(:?([0-9]{2}))?)))?)?"
  );

  /**
   * Sets options for encoding Date objects to ISO8601 strings.
   * Omitting the 'opts' argument will reset all options to the default.
   */
  setOpts(opts?: Partial<DateFormatterOptions>): void {
    const source = opts ?? DateFormatter.DEFAULT_OPTIONS;
    const next: DateFormatterOptions = { ...DateFormatter.DEFAULT_OPTIONS } as DateFormatterOptions;

    (Object.keys(DateFormatter.DEFAULT_OPTIONS) as Array<keyof DateFormatterOptions>).forEach((k) => {
      next[k] = (Object.prototype.hasOwnProperty.call(source, k)
        ? (source as any)[k]
        : (DateFormatter.DEFAULT_OPTIONS as any)[k]) as any;
    });

    this.opts = next;
  }

  /**
   * Converts ISO8601 string to a Date.
   */
  decodeIso8601(time: string): Date {
    const dateParts = time.toString().match(DateFormatter.ISO8601);
    if (!dateParts) {
      throw new Error("Expected a ISO8601 datetime but got '" + time + "'");
    }

    const date =
      [
        [dateParts[1], dateParts[3] || "01", dateParts[5] || "01"].join("-"),
        "T",
        [dateParts[7] || "00", dateParts[11] || "00", dateParts[14] || "00"].join(":"),
        ".",
        dateParts[16] || "000",
      ].join("") +
      (dateParts[17] !== undefined
        ? dateParts[17] + (dateParts[19] && dateParts[20] === undefined ? "00" : "")
        : DateFormatter.formatCurrentOffset(new Date())
      );

    return new Date(date);
    // Note: original used `new Date(date)` where `date` was built then offset appended.
  }

  /**
   * Converts a Date to ISO8601 string using current options.
   */
  encodeIso8601(date: Date): string {
    const parts = this.opts.local
      ? DateFormatter.getLocalDateParts(date)
      : DateFormatter.getUTCDateParts(date);

    return [
      [parts[0], parts[1], parts[2]].join(this.opts.hyphens ? "-" : ""),
      "T",
      [parts[3], parts[4], parts[5]].join(this.opts.colons ? ":" : ""),
      this.opts.ms ? "." + parts[6] : "",
      this.opts.local ? (this.opts.offset ? DateFormatter.formatCurrentOffset(date) : "") : "Z",
    ].join("");
  }

  /**
   * UTC parts (YYYY, MM, DD, hh, mm, ss, mmm) with zero-padding where needed.
   */
  static getUTCDateParts(date: Date): (string | number)[] {
    return [
      date.getUTCFullYear(),
      DateFormatter.zeroPad(date.getUTCMonth() + 1, 2),
      DateFormatter.zeroPad(date.getUTCDate(), 2),
      DateFormatter.zeroPad(date.getUTCHours(), 2),
      DateFormatter.zeroPad(date.getUTCMinutes(), 2),
      DateFormatter.zeroPad(date.getUTCSeconds(), 2),
      DateFormatter.zeroPad(date.getUTCMilliseconds(), 3),
    ];
  }

  /**
   * Local parts (YYYY, MM, DD, hh, mm, ss, mmm) with zero-padding where needed.
   */
  static getLocalDateParts(date: Date): (string | number)[] {
    return [
      date.getFullYear(),
      DateFormatter.zeroPad(date.getMonth() + 1, 2),
      DateFormatter.zeroPad(date.getDate(), 2),
      DateFormatter.zeroPad(date.getHours(), 2),
      DateFormatter.zeroPad(date.getMinutes(), 2),
      DateFormatter.zeroPad(date.getSeconds(), 2),
      DateFormatter.zeroPad(date.getMilliseconds(), 3),
    ];
  }

  /**
   * Left-pad a number with zeros to the specified length.
   */
  static zeroPad(digit: number, length: number): string {
    let padded = "" + digit;
    while (padded.length < length) padded = "0" + padded;
    return padded;
  }

  /**
   * Returns timezone offset in "Z" or "+/-HH:MM" form (for the given date or now).
   */
  static formatCurrentOffset(d?: Date): string {
    const offset = (d || new Date()).getTimezoneOffset(); // minutes, positive = behind UTC
    if (offset === 0) return "Z";
    const sign = offset < 0 ? "+" : "-";
    const hh = DateFormatter.zeroPad(Math.abs(Math.floor(offset / 60)), 2);
    const mm = DateFormatter.zeroPad(Math.abs(offset % 60), 2);
    return `${sign}${hh}:${mm}`;
  }
}

// Export an instance (matches original CommonJS default behavior)
const dateFormatter = new DateFormatter();
export default dateFormatter;
