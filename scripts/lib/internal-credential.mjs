import {randomBytes} from 'node:crypto';
// 48 random bytes = 384 bits; URL-safe, 64 characters. Never derived from PIN.
export function generateInternalCredential(){return randomBytes(48).toString('base64url');}
export function assertRotationTarget(projectRef,userId){
 if(projectRef!=='kwuhkahuhacemmgbgffw'||userId!=='e4afb7c8-0915-4b5f-8805-66c292a5d3b6')throw Error('Staging canonical target required');
}
