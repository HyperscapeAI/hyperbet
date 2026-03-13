declare module "bs58" {
    const bs58: {
        encode(source: Uint8Array | number[]): string;
        decode(string: string): Uint8Array;
        decodeUnsafe(string: string): Uint8Array | undefined;
    };
    export default bs58;
}
