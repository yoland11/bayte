import {it,expect} from 'vitest';
import {generateInternalCredential,assertRotationTarget} from '../../scripts/lib/internal-credential.mjs';
it('generates independent high entropy server credentials',()=>{
 const a=generateInternalCredential(),b=generateInternalCredential();expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);expect(a).not.toBe(b);
});
it('refuses production or wrong identity in staging tooling',()=>{
 expect(()=>assertRotationTarget('irnwbayhxawphkxmbnbx','e4afb7c8-0915-4b5f-8805-66c292a5d3b6')).toThrow();
 expect(()=>assertRotationTarget('kwuhkahuhacemmgbgffw','different')).toThrow();
 expect(()=>assertRotationTarget('kwuhkahuhacemmgbgffw','e4afb7c8-0915-4b5f-8805-66c292a5d3b6')).not.toThrow();
});
