// customType.mts

/**
 * Represents a custom XML-RPC type.
 */
export default class CustomType {
  raw: string;

  constructor(raw: string) {
    this.raw = raw;
  }

  /**
   * Serializes this custom type into XML.
   * @param xml XML builder object (must have `.ele()` and `.txt()` methods).
   */
  serialize(xml: { ele: (tag: string) => { txt: (val: string) => any } }): any {
    return xml.ele(this.tagName).txt(this.raw);
  }

  /** XML-RPC tag name */
  get tagName(): string {
    return "customType";
  }
}
