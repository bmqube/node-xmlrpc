// serializer.mts
import * as xmlBuilder from "xmlbuilder";
import dateFormatter from "./date_formatter.mjs";
import CustomType from "./customtype.mjs";

// Minimal shape for the xmlbuilder nodes we use
type XmlNode = {
  ele: (name: string, ...args: any[]) => XmlNode;
  txt: (value: string | number) => XmlNode;
  text?: (value: string | number) => XmlNode; // xmlbuilder also has .text()
  up: () => XmlNode;
  d?: (value: string) => XmlNode; // CDATA writer (xmlbuilder has .cdata(), original used .d)
  cdata?: (value: string) => XmlNode;
  doc: () => { toString: () => string };
};

type Encoding = BufferEncoding | undefined;

/**
 * Creates the XML for an XML-RPC method call.
 */
export function serializeMethodCall(
  method: string,
  paramsInput?: any[],
  encoding?: Encoding
): string {
  const params = paramsInput ?? [];

  const options: any = { version: "1.0", allowSurrogateChars: true };
  if (encoding) options.encoding = encoding;

  const xml = (xmlBuilder.create("methodCall", options) as unknown as XmlNode)
    .ele("methodName")
    .txt(method)
    .up()
    .ele("params");

  params.forEach((param) => {
    serializeValue(param, xml.ele("param"));
  });

  // Includes the <?xml ...> declaration
  return xml.doc().toString();
}

/**
 * Creates the XML for an XML-RPC method response.
 */
export function serializeMethodResponse(result: any): string {
  const xml = (xmlBuilder.create("methodResponse", {
    version: "1.0",
    allowSurrogateChars: true,
  }) as unknown as XmlNode)
    .ele("params")
    .ele("param");

  serializeValue(result, xml);

  return xml.doc().toString();
}

/**
 * Creates the XML for an XML-RPC fault response.
 */
export function serializeFault(fault: any): string {
  const xml = (xmlBuilder.create("methodResponse", {
    version: "1.0",
    allowSurrogateChars: true,
  }) as unknown as XmlNode).ele("fault");

  serializeValue(fault, xml);

  return xml.doc().toString();
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type Frame = {
  value: any;
  xml: XmlNode;
  index?: number;
  keys?: string[];
};

function serializeValue(value: any, xml: XmlNode): void {
  const stack: Frame[] = [{ value, xml }];
  let current: Frame | null = null;
  let valueNode: XmlNode | null = null;
  let next: Frame | null = null;

  while (stack.length > 0) {
    current = stack[stack.length - 1];

    if (current.index !== undefined) {
      // Iterating a compound
      next = getNextItemsFrame(current);
      if (next) {
        stack.push(next);
      } else {
        stack.pop();
      }
    } else {
      // about to add a new value (compound or simple)
      valueNode = current.xml.ele("value");
      switch (typeof current.value) {
        case "boolean":
          appendBoolean(current.value, valueNode);
          stack.pop();
          break;
        case "string":
          appendString(current.value, valueNode);
          stack.pop();
          break;
        case "number":
          appendNumber(current.value, valueNode);
          stack.pop();
          break;
        case "object":
          if (current.value === null) {
            valueNode.ele("nil");
            stack.pop();
          } else if (current.value instanceof Date) {
            appendDatetime(current.value, valueNode);
            stack.pop();
          } else if (Buffer.isBuffer(current.value)) {
            appendBuffer(current.value, valueNode);
            stack.pop();
          } else if (current.value instanceof CustomType) {
            current.value.serialize(valueNode);
            stack.pop();
          } else {
            if (Array.isArray(current.value)) {
              current.xml = valueNode.ele("array").ele("data");
            } else {
              current.xml = valueNode.ele("struct");
              current.keys = Object.keys(current.value);
            }
            current.index = 0;
            next = getNextItemsFrame(current);
            if (next) {
              stack.push(next);
            } else {
              stack.pop();
            }
          }
          break;
        default:
          // unsupported value types are ignored (parity with original)
          stack.pop();
          break;
      }
    }
  }
}

function getNextItemsFrame(frame: Frame): Frame | null {
  let nextFrame: Frame | null = null;

  if (frame.keys) {
    if (frame.index! < frame.keys.length) {
      const key = frame.keys[frame.index!++];
      const member = frame.xml.ele("member").ele("name");
      // original used .text(key) then .up()
      (member.text ? member.text(key) : member.txt(key)).up?.();
      nextFrame = {
        value: frame.value[key],
        xml: member, // the JS original attaches next value node at member-level
      };
    }
  } else if (frame.index! < frame.value.length) {
    nextFrame = {
      value: frame.value[frame.index!],
      xml: frame.xml,
    };
    frame.index = frame.index! + 1;
  }

  return nextFrame;
}

function appendBoolean(value: boolean, xml: XmlNode): void {
  xml.ele("boolean").txt(value ? 1 : 0);
}

const illegalChars = /^(?![^<&]*]]>[^<&]*)[^<&]*$/;

function appendString(value: string, xml: XmlNode): void {
  if (value.length === 0) {
    xml.ele("string");
    return;
  }

  if (!illegalChars.test(value)) {
    const str = xml.ele("string");
    if (typeof (str as any).d === "function") {
      (str as any).d(value);
    } else if (typeof (str as any).cdata === "function") {
      (str as any).cdata(value);
    } else {
      str.txt(value);
    }
    return;
  }

  xml.ele("string").txt(value);
}


function appendNumber(value: number, xml: XmlNode): void {
  if (value % 1 === 0) {
    xml.ele("int").txt(value);
  } else {
    xml.ele("double").txt(value);
  }
}

function appendDatetime(value: Date, xml: XmlNode): void {
  xml.ele("dateTime.iso8601").txt(dateFormatter.encodeIso8601(value));
}

function appendBuffer(value: Buffer, xml: XmlNode): void {
  xml.ele("base64").txt(value.toString("base64"));
}

// Default export that mirrors the CommonJS `module.exports = { ... }` style
const Serializer = {
  serializeMethodCall,
  serializeMethodResponse,
  serializeFault,
};

export default Serializer;
