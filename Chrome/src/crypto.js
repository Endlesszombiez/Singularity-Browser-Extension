const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export async function getOrCreateEncryptionKey(storageApi, storageKeyName) {
  const stored = await storageApi.get(storageKeyName);
  const existingKey = stored[storageKeyName];

  if (existingKey) {
    return existingKey;
  }

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const base64Key = bytesToBase64(rawKey);
  await storageApi.set({ [storageKeyName]: base64Key });

  return base64Key;
}

async function importAesKey(base64Key) {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(base64Key),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJson(value, base64Key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await importAesKey(base64Key);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encoder.encode(JSON.stringify(value))
  );

  return {
    iv: bytesToBase64(iv),
    payload: bytesToBase64(new Uint8Array(cipherBuffer))
  };
}

export async function decryptJson(value, base64Key) {
  if (!value?.iv || !value?.payload) {
    return null;
  }

  const aesKey = await importAesKey(base64Key);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(value.iv) },
    aesKey,
    base64ToBytes(value.payload)
  );

  return JSON.parse(decoder.decode(plainBuffer));
}
