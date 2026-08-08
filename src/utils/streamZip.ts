import { Zip, ZipPassThrough } from 'fflate';

export async function createStreamingZip(filename: string): Promise<{
    addFile: (name: string, data: Uint8Array) => void;
    close: () => Promise<void>;
    abort: () => Promise<void>;
}> {
    let writable: any = null;
    let fallbackChunks: Uint8Array[] = [];
    let zip = new Zip();
    
    // Try File System Access API first (Chrome/Edge)
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await (window as any).showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
            });
            writable = await handle.createWritable();
        } catch (e: any) {
            if (e.name === 'AbortError') {
                throw new Error("USER_ABORT"); // Stop export if user cancels
            }
            console.warn("File System API failed, falling back to Blob memory", e);
        }
    }

    let onDataPromise: Promise<void> = Promise.resolve();

    zip.ondata = (err, dat, final) => {
        if (err) throw err;
        
        onDataPromise = onDataPromise.then(async () => {
            if (writable) {
                await writable.write(dat);
            } else {
                fallbackChunks.push(new Uint8Array(dat)); // CLONE the array because fflate reuses the buffer!
            }
        });
    };

    return {
        addFile: (name: string, data: Uint8Array) => {
            const file = new ZipPassThrough(name);
            zip.add(file);
            file.push(data, true); // true indicates end of this file
        },
        close: async () => {
            zip.end();
            await onDataPromise; // wait for all data to be flushed
            
            if (writable) {
                await writable.close();
            } else {
                const blob = new Blob(fallbackChunks, { type: 'application/zip' });
                fallbackChunks = []; // free memory
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        },
        abort: async () => {
            if (writable) {
                try { await writable.abort(); } catch(e) {}
            }
            fallbackChunks = [];
        }
    };
}
