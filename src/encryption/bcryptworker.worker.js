import bcrypt from 'bcryptjs'


self.onmessage = function (e) {
    const { hashBase64, salt } = e.data;
    try {
        const result = bcrypt.hashSync(hashBase64, salt);
        self.postMessage({ result });
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};