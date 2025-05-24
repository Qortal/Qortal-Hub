import { bcrypt } from 'hash-wasm';

self.onmessage = async function (e) {
    const { hashBase64, salt } = e.data;

    try {
        // Split the salt string
        const parts = salt.split('$');
        if (parts.length !== 4) {
            throw new Error('Invalid salt format');
        }

        // Extract the raw salt from the bcrypt salt string
        const rawSalt = parts[3]; // e.g., "IxVE941tXVUD4cW0TNVm.O"

        // Bcrypt's custom Base64 decoding function
        function bcryptBase64Decode(base64String) {
            const base64Code = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            const inverseBase64Code = {};
            for (let i = 0; i < base64Code.length; i++) {
                inverseBase64Code[base64Code[i]] = i;
            }
            const bytes = [];
            let i = 0;
            while (i < base64String.length) {
                const c1 = inverseBase64Code[base64String.charAt(i++)];
                const c2 = inverseBase64Code[base64String.charAt(i++)];
                bytes.push(((c1 << 2) | (c2 >> 4)) & 0xff);

                if (i >= base64String.length) break;

                const c3 = inverseBase64Code[base64String.charAt(i++)];
                bytes.push(((c2 << 4) | (c3 >> 2)) & 0xff);

                if (i >= base64String.length) break;

                const c4 = inverseBase64Code[base64String.charAt(i++)];
                bytes.push(((c3 << 6) | c4) & 0xff);
            }
            return new Uint8Array(bytes);
        }

        // Decode the bcrypt Base64 salt into a Uint8Array
        const saltArray = bcryptBase64Decode(rawSalt);
       
        if (saltArray.length !== 16) {
            throw new Error('Salt must be 16 bytes long for hash-wasm.');
        }

        // Extract the cost factor
        const costFactor = parseInt(parts[2], 10);

        // Determine if 'hashBase64' is the password or needs decoding
        const password = hashBase64; // Adjust if 'hashBase64' is encoded

        // Compute the hash using hash-wasm
        const result = await bcrypt({
            password: password,
            salt: saltArray,
            costFactor: costFactor,
            outputType: 'encoded', // Outputs in bcrypt format
        });


        // Return the result to the main thread
        self.postMessage({ result });
    } catch (error) {
        console.error('Error in Web Worker:', error);
        self.postMessage({ error: error.message });
    }
};
