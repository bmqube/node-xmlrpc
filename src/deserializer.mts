// Deserializer.mts
import * as sax from "sax";
// If `date_formatter` is CommonJS and you *don't* use `esModuleInterop`,
// prefer:  import dateFormatter from "./date_formatter.js";  (Node ESM default import gets CJS exports)
// If your tooling complains, turn on `esModuleInterop` or switch to:
//   // import * as dateFormatterNS from "./date_formatter.js";
//   // const dateFormatter = (dateFormatterNS as any).default ?? dateFormatterNS;
import dateFormatter from "./date_formatter.mjs";

type XMLRPCValue =
  | null
  | boolean
  | number
  | string
  | Date
  | Buffer
  | XMLRPCValue[]
  | { [key: string]: XMLRPCValue };

type MethodResponseCallback = (error: Error | null, result?: any) => void;
type MethodCallCallback = (error: Error | null, methodName?: string, params?: any[]) => void;

export default class Deserializer {
  type: "methodresponse" | "methodcall" | null;
  responseType: "params" | "fault" | null;
  stack: XMLRPCValue[];
  marks: number[];
  data: string[];
  methodname: string | null;
  encoding: BufferEncoding;
  value: boolean;
  callback: ((error: Error | null, result?: any) => void) | null;
  error: Error | null;

  parser: sax.SAXStream;

  constructor(encoding?: BufferEncoding) {
    this.type = null;
    this.responseType = null;
    this.stack = [];
    this.marks = [];
    this.data = [];
    this.methodname = null;
    this.encoding = encoding || "utf8";
    this.value = false;
    this.callback = null;
    this.error = null;

    this.parser = sax.createStream();
    this.parser.on("opentag", this.onOpentag.bind(this));
    this.parser.on("closetag", this.onClosetag.bind(this));
    this.parser.on("text", this.onText.bind(this));
    this.parser.on("cdata", this.onCDATA.bind(this));
    this.parser.on("end", this.onDone.bind(this));
    this.parser.on("error", this.onError.bind(this));
  }

  deserializeMethodResponse(stream: NodeJS.ReadableStream, callback: MethodResponseCallback): void {
    const that = this;

    this.callback = function (error: Error | null, result?: any) {
      if (error) {
        callback(error);
      } else if (Array.isArray(result) && result.length > 1) {
        callback(new Error("Response has more than one param"));
      } else if (that.type !== "methodresponse") {
        callback(new Error("Not a method response"));
      } else if (!that.responseType) {
        callback(new Error("Invalid method response"));
      } else {
        callback(null, Array.isArray(result) ? result[0] : result);
      }
    };

    stream.setEncoding(this.encoding);
    stream.on("error", this.onError.bind(this));
    (stream as any).pipe(this.parser);
  }

  deserializeMethodCall(stream: NodeJS.ReadableStream, callback: MethodCallCallback): void {
    const that = this;

    this.callback = function (error: Error | null, result?: any) {
      if (error) {
        callback(error);
      } else if (that.type !== "methodcall") {
        callback(new Error("Not a method call"));
      } else if (!that.methodname) {
        callback(new Error("Method call did not contain a method name"));
      } else {
        callback(null, that.methodname, result);
      }
    };

    stream.setEncoding(this.encoding);
    stream.on("error", this.onError.bind(this));
    (stream as any).pipe(this.parser);
  }

  // Called when the SAX parser finishes
  private onDone(): void {
    if (!this.error) {
      if (this.type === null || this.marks.length) {
        this.callback?.(new Error("Invalid XML-RPC message"));
      } else if (this.responseType === "fault") {
        const createFault = (fault: any) => {
          const error = new Error(
            "XML-RPC fault" + (fault?.faultString ? ": " + fault.faultString : "")
          ) as Error & { code?: any; faultCode?: any; faultString?: any };
          error.code = fault?.faultCode;
          error.faultCode = fault?.faultCode;
          error.faultString = fault?.faultString;
          return error;
        };
        this.callback?.(createFault(this.stack[0]));
      } else {
        this.callback?.(null, this.stack);
      }
    }
  }

  // See TODO in original: low-level vs protocol errors.
  private onError(msg: unknown): void {
    if (!this.error) {
      if (typeof msg === "string") {
        this.error = new Error(msg);
      } else if (msg instanceof Error) {
        this.error = msg;
      } else {
        this.error = new Error("Unknown error");
      }
      this.callback?.(this.error);
    }
  }

  private push(value: XMLRPCValue): void {
    this.stack.push(value);
  }

  //==============================================================================
  // SAX Handlers
  //==============================================================================

  private onOpentag(node: sax.Tag | sax.QualifiedTag): void {
    // The original code compares uppercase tag names.
    // We keep the behavior unchanged, relying on the sax stream's current settings.
    const name = (node as any).name as string;
    if (name === "ARRAY" || name === "STRUCT") {
      this.marks.push(this.stack.length);
    }
    this.data = [];
    this.value = name === "VALUE";
  }

  private onText(text: string): void {
    this.data.push(text);
  }

  private onCDATA(cdata: string): void {
    this.data.push(cdata);
  }

  private onClosetag(el: string): void {
    const data = this.data.join("");
    try {
      switch (el) {
        case "BOOLEAN":
          this.endBoolean(data);
          break;
        case "INT":
        case "I4":
          this.endInt(data);
          break;
        case "I8":
          this.endI8(data);
          break;
        case "DOUBLE":
          this.endDouble(data);
          break;
        case "STRING":
        case "NAME":
          this.endString(data);
          break;
        case "ARRAY":
          this.endArray();
          break;
        case "STRUCT":
          this.endStruct();
          break;
        case "BASE64":
          this.endBase64(data);
          break;
        case "DATETIME.ISO8601":
          this.endDateTime(data);
          break;
        case "VALUE":
          this.endValue(data);
          break;
        case "PARAMS":
          this.endParams();
          break;
        case "FAULT":
          this.endFault();
          break;
        case "METHODRESPONSE":
          this.endMethodResponse();
          break;
        case "METHODNAME":
          this.endMethodName(data);
          break;
        case "METHODCALL":
          this.endMethodCall();
          break;
        case "NIL":
          this.endNil();
          break;
        case "DATA":
        case "PARAM":
        case "MEMBER":
          // Ignored by design
          break;
        default:
          console.warn("Ignoring unknown XML-RPC tag:", el);
          // this.onError(`Unknown XML-RPC tag '${el}'`);
          break;
      }
    } catch (e) {
      this.onError(e);
    }
  }

  //==============================================================================
  // End-* helpers (mirroring original semantics)
  //==============================================================================

  private endNil(): void {
    this.push(null);
    this.value = false;
  }

  private endBoolean(data: string): void {
    if (data === "1") {
      this.push(true);
    } else if (data === "0") {
      this.push(false);
    } else {
      throw new Error("Illegal boolean value '" + data + "'");
    }
    this.value = false;
  }

  private endInt(data: string): void {
    const value = parseInt(data, 10);
    if (Number.isNaN(value)) {
      throw new Error("Expected an integer but got '" + data + "'");
    } else {
      this.push(value);
      this.value = false;
    }
  }

  private endDouble(data: string): void {
    const value = parseFloat(data);
    if (Number.isNaN(value)) {
      throw new Error("Expected a double but got '" + data + "'");
    } else {
      this.push(value);
      this.value = false;
    }
  }

  private endString(data: string): void {
    this.push(data);
    this.value = false;
  }

  private endArray(): void {
    const mark = this.marks.pop();
    if (mark === undefined) throw new Error("Array mark stack underflow");
    const arr = this.stack.slice(mark);
    // Replace the stack segment with the array as a single value
    this.stack.splice(mark, this.stack.length - mark);
    this.stack.push(arr);
    this.value = false;
  }

  private endStruct(): void {
    const mark = this.marks.pop();
    if (mark === undefined) throw new Error("Struct mark stack underflow");
    const items = this.stack.slice(mark);
    const struct: { [key: string]: XMLRPCValue } = {};

    for (let i = 0; i < items.length; i += 2) {
      const key = String(items[i]); // original assumes name/string
      struct[key] = items[i + 1] as XMLRPCValue;
    }

    this.stack.splice(mark, this.stack.length - mark);
    this.stack.push(struct);
    this.value = false;
  }

  private endBase64(data: string): void {
    const buffer = Buffer.from(data, "base64");
    this.push(buffer);
    this.value = false;
  }

  private endDateTime(data: string): void {
    const date = dateFormatter.decodeIso8601(data);
    this.push(date);
    this.value = false;
  }

  private static readonly isInteger = /^-?\d+$/;

  private endI8(data: string): void {
    if (!Deserializer.isInteger.test(data)) {
      throw new Error("Expected integer (I8) value but got '" + data + "'");
    } else {
      // keep as string to preserve 64-bit range safety
      this.endString(data);
    }
  }

  private endValue(data: string): void {
    if (this.value) {
      this.endString(data);
    }
  }

  private endParams(): void {
    this.responseType = "params";
  }

  private endFault(): void {
    this.responseType = "fault";
  }

  private endMethodResponse(): void {
    this.type = "methodresponse";
  }

  private endMethodName(data: string): void {
    this.methodname = data;
  }

  private endMethodCall(): void {
    this.type = "methodcall";
  }
}
