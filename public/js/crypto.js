// End-to-end encryption for DMs using Web Crypto API (ECDH P-256 + AES-GCM)
// Compatible with Android client using the same primitives.

const CRYPTO_DB_NAME = 'socialchat_crypto';
const CRYPTO_DB_VERSION = 1;
const CRYPTO_STORE = 'keys';

// Cached userId — avoids re-fetching /api/auth/me repeatedly
let _myUserIdCache = null;

async function getMyUserId() {
    if (_myUserIdCache) return _myUserIdCache;
    if (window.currentUser && window.currentUser.id) {
        _myUserIdCache = window.currentUser.id;
        return _myUserIdCache;
    }
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            _myUserIdCache = data.user ? data.user.id : null;
        }
    } catch {}
    return _myUserIdCache;
}

// --- Key Generation ---

async function generateKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey']
    );
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    return { publicKeyJwk, privateKeyJwk };
}

// --- Private Key Encryption (password-derived) ---

async function encryptPrivateKey(privateKeyJwk, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const wrappingKey = await deriveWrappingKey(password, salt);

    const encoded = new TextEncoder().encode(JSON.stringify(privateKeyJwk));
    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        wrappingKey,
        encoded
    );

    return {
        encryptedData: bufToBase64(encryptedBuffer),
        iv: bufToBase64(iv),
        salt: bufToBase64(salt)
    };
}

async function decryptPrivateKey(blob, password) {
    const salt = base64ToBuf(blob.salt);
    const iv = base64ToBuf(blob.iv);
    const encryptedData = base64ToBuf(blob.encryptedData);

    const wrappingKey = await deriveWrappingKey(password, salt);

    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        wrappingKey,
        encryptedData
    );

    return JSON.parse(new TextDecoder().decode(decryptedBuffer));
}

async function deriveWrappingKey(password, salt) {
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// --- Shared Key Derivation ---

async function deriveSharedKey(myPrivateJwk, theirPublicJwk) {
    const myPrivateKey = await crypto.subtle.importKey(
        'jwk',
        myPrivateJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveKey']
    );

    const theirPublicKey = await crypto.subtle.importKey(
        'jwk',
        theirPublicJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        []
    );

    return crypto.subtle.deriveKey(
        { name: 'ECDH', public: theirPublicKey },
        myPrivateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// --- Message Encryption ---

async function encryptMessage(plaintext, sharedKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertextBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        sharedKey,
        encoded
    );

    return {
        ciphertext: bufToBase64(ciphertextBuffer),
        iv: bufToBase64(iv)
    };
}

async function decryptMessage(ciphertext, iv, sharedKey) {
    const ciphertextBuf = base64ToBuf(ciphertext);
    const ivBuf = base64ToBuf(iv);

    const plaintextBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuf },
        sharedKey,
        ciphertextBuf
    );

    return new TextDecoder().decode(plaintextBuffer);
}

// --- IndexedDB Key Cache ---

function openCryptoDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(CRYPTO_DB_NAME, CRYPTO_DB_VERSION);
        req.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(CRYPTO_STORE, { keyPath: 'userId' });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function cachePrivateKey(userId, jwk) {
    const db = await openCryptoDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CRYPTO_STORE, 'readwrite');
        tx.objectStore(CRYPTO_STORE).put({ userId, jwk });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function getCachedPrivateKey(userId) {
    const db = await openCryptoDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CRYPTO_STORE, 'readonly');
        const req = tx.objectStore(CRYPTO_STORE).get(userId);
        req.onsuccess = (e) => resolve(e.target.result ? e.target.result.jwk : null);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function clearCachedKeys() {
    _myUserIdCache = null;
    const db = await openCryptoDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CRYPTO_STORE, 'readwrite');
        tx.objectStore(CRYPTO_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

// --- Orchestrator ---

// explicitUserId: pass from auth response so we don't need window.currentUser
async function initializeCryptoKeys(password, explicitUserId = null) {
    try {
        // Resolve userId — prefer explicit (passed from login/register response),
        // fall back to window.currentUser, fall back to server fetch.
        if (explicitUserId) _myUserIdCache = explicitUserId;
        const userId = await getMyUserId();

        // Check IndexedDB cache first
        if (userId) {
            const cached = await getCachedPrivateKey(userId);
            if (cached) return; // Already have the key
        }

        // Check if server has our encrypted private key
        const meRes = await fetch('/api/keys/me');
        if (meRes.ok) {
            const data = await meRes.json();
            if (data.encryptedPrivateKey) {
                const blob = {
                    encryptedData: data.encryptedPrivateKey,
                    iv: data.keyIv,
                    salt: data.keySalt
                };
                const privateKeyJwk = await decryptPrivateKey(blob, password);
                if (userId) await cachePrivateKey(userId, privateKeyJwk);
                return;
            }
        }

        // No keys on server — generate new pair
        const { publicKeyJwk, privateKeyJwk } = await generateKeyPair();
        const encryptedBlob = await encryptPrivateKey(privateKeyJwk, password);

        await fetch('/api/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                publicKey: JSON.stringify(publicKeyJwk),
                encryptedPrivateKey: encryptedBlob.encryptedData,
                keyIv: encryptedBlob.iv,
                keySalt: encryptedBlob.salt
            })
        });

        if (userId) await cachePrivateKey(userId, privateKeyJwk);
    } catch (err) {
        console.error('Crypto initialization error:', err);
    }
}

// --- Helpers ---

function bufToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBuf(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
