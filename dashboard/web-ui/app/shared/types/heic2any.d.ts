declare module 'heic2any' {
    interface Options {
        blob: Blob;
        toType?: string;
        quality?: number;
        multiple?: boolean;
    }

    function heic2any(options: Options): Promise<Blob | Blob[]>;
    export default heic2any;
}
