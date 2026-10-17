import {createHash} from 'node:crypto';
// Equivalent to canonical(nativeJson(value)), without a document-sized string.
export function* nativeCanonicalTokens(value){
 if(value instanceof Uint8Array){yield '{"binary_base64url":';yield JSON.stringify(Buffer.from(value).toString('base64url'));yield '}';return;}
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)){yield JSON.stringify(value);return;}
 if(Array.isArray(value)){yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';if(!Object.hasOwn(value,i)){yield 'null';continue;}yield* nativeCanonicalTokens(value[i]);}yield ']';return;}
 if(value&&Object.getPrototypeOf(value)===Object.prototype){const keys=Object.keys(value);if(keys.some(k=>['__proto__','constructor','prototype'].includes(k)))throw Error('EMAIL_NATIVE_RETAINED_INVALID');
 // JSON.stringify enumerates integer keys numerically even after lexical sorting.
 const ordered=Object.keys(Object.fromEntries(keys.sort().map(k=>[k,null])));yield '{';for(let i=0;i<ordered.length;i++){if(i)yield ',';yield JSON.stringify(ordered[i]);yield ':';yield* nativeCanonicalTokens(value[ordered[i]]);}yield '}';return;}
 throw Error('EMAIL_NATIVE_RETAINED_INVALID');
}
export function* nativeCanonicalChunks(value){let batch='';for(const token of nativeCanonicalTokens(value)){if(batch.length+token.length>65536&&batch){yield batch;batch='';}if(token.length>65536)yield token;else batch+=token;}if(batch)yield batch;}
export function nativeStreamingDigest(value){const hash=createHash('sha256');if(typeof value==='string')hash.update(value);else for(const chunk of nativeCanonicalChunks(value))hash.update(chunk);return hash.digest('hex');}
