// Local preparation only; no Supabase, network or production writes.
import argon2 from '@node-rs/argon2';
import{verifyExistingPin,savePrivateFile}from'./operator-credentials.mjs';
export async function preparePinRotation({currentHash,newPin,confirmation,output}){
 if(!/^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.test(currentHash??''))throw Error('Approved existing hash required');
 if(!/^\d{6,12}$/.test(newPin??'')||newPin!==confirmation)throw Error('PIN confirmation invalid');
 if(await verifyExistingPin(currentHash,newPin))throw Error('Compromised PIN reuse refused');
 const hash=await argon2.hash(newPin,{algorithm:argon2.Algorithm.Argon2id,memoryCost:65536,timeCost:3,parallelism:1,outputLen:32});
 if(!await verifyExistingPin(hash,newPin))throw Error('Hash verification failed');
 await savePrivateFile(output,hash+'\n');
}
