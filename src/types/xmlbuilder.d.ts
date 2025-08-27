// types/xmlbuilder/index.d.ts
declare module "xmlbuilder" {
    export interface XMLNode {
        ele(name: string, ...args: any[]): XMLNode;
        txt(value: string | number): XMLNode;
        text(value: string | number): XMLNode;
        up(): XMLNode;
        d(value: string): XMLNode;      // CDATA (older xmlbuilder aliases)
        cdata(value: string): XMLNode;  // CDATA (newer name)
        doc(): { toString(): string };
    }

    export function create(name: string, options?: any): XMLNode;
}
