/* Public client: no key, answer or personal content belongs in this module. */
const FORMAT = 'noux-v1';
const MAX_CIPHERTEXT_LENGTH = 60_000_000;

function decodeBase64Url(value, label) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} invalide.`);
  }
  try {
    const standard = value.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(standard + '='.repeat((4 - standard.length % 4) % 4)), c => c.charCodeAt(0));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const canonical = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (canonical !== value) throw new Error('Base64 non canonique');
    return bytes;
  } catch {
    throw new Error(`${label} invalide.`);
  }
}

/** Decrypt an authenticated AES-256-GCM JSON envelope with a 32-byte URL-safe key. */
export async function decryptJSON(envelope, secret) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Le carnet nécessite une connexion HTTPS ou une ouverture sur localhost.');
  }
  if (typeof secret !== 'string' || secret.length !== 43) {
    throw new Error('La clé du carnet doit contenir 32 octets au format base64url.');
  }
  const keyBytes = decodeBase64Url(secret, 'Clé du carnet');
  if (keyBytes.length !== 32) throw new Error('La clé du carnet doit contenir 32 octets.');
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.format !== FORMAT) {
    throw new Error('Le format du carnet est invalide.');
  }
  if (typeof envelope.iv !== 'string' || envelope.iv.length !== 16) {
    throw new Error('Le sceau du carnet est invalide.');
  }
  if (typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length < 22 || envelope.ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
    throw new Error('Le contenu chiffré du carnet est invalide.');
  }
  const iv = decodeBase64Url(envelope.iv, 'Sceau du carnet');
  const ciphertext = decodeBase64Url(envelope.ciphertext, 'Contenu chiffré');
  if (iv.length !== 12 || ciphertext.length < 16) throw new Error('Le contenu chiffré du carnet est invalide.');
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ciphertext);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Objet JSON attendu');
    return value;
  } catch {
    throw new Error('Impossible d’ouvrir le carnet. Vérifie la clé du lien et réessaie.');
  } finally {
    keyBytes.fill(0);
  }
}
