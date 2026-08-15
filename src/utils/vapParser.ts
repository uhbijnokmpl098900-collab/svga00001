export const parseVapMetadata = async (file: File): Promise<any> => {
    // A VAP file is an MP4 file. The vapc box is usually at the very end.
    // Let's read the last 1MB (or whole file if smaller) to find 'vapc'.
    const chunkSize = 1024 * 1024; // 1MB
    const start = Math.max(0, file.size - chunkSize);
    const blob = file.slice(start, file.size);
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    
    // Search for 'vapc' (0x76, 0x61, 0x70, 0x63)
    let vapcOffset = -1;
    for (let i = 0; i < bytes.length - 4; i++) {
        if (bytes[i] === 0x76 && bytes[i+1] === 0x61 && bytes[i+2] === 0x70 && bytes[i+3] === 0x63) {
            vapcOffset = i;
            break;
        }
    }
    
    if (vapcOffset === -1) {
        throw new Error('Not a valid VAP file. No vapc metadata found.');
    }
    
    // The 4 bytes before 'vapc' are the size of the box (including size and type)
    if (vapcOffset < 4) {
        throw new Error('Invalid vapc box size offset.');
    }
    
    const sizeBytes = bytes.slice(vapcOffset - 4, vapcOffset);
    const dataView = new DataView(sizeBytes.buffer);
    const boxSize = dataView.getUint32(0, false);
    
    // The JSON data starts right after 'vapc' (which is at vapcOffset + 4)
    // The length of the JSON string is boxSize - 8 (since size is 4 and type is 4)
    const jsonStart = vapcOffset + 4;
    const jsonLength = boxSize - 8;
    
    if (jsonStart + jsonLength > bytes.length) {
        throw new Error('vapc box size exceeds file bounds.');
    }
    
    const jsonBytes = bytes.slice(jsonStart, jsonStart + jsonLength);
    const decoder = new TextDecoder('utf-8');
    const jsonString = decoder.decode(jsonBytes);
    
    // Sometimes it's padded with null bytes
    const cleanJsonString = jsonString.replace(/\0/g, '');
    
    try {
        const metadata = JSON.parse(cleanJsonString);
        return metadata;
    } catch (e) {
        throw new Error('Failed to parse VAP metadata JSON.');
    }
};
