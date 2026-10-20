// Operator must separately approve rotation. This prepares a NEW local hash only.
// No plaintext PIN, hash, exception or credential is printed; no network calls.
import{emitKeypressEvents}from'node:readline';import{resolve}from'node:path';
import{readPrivateFile}from'./lib/operator-credentials.mjs';
import{preparePinRotation}from'./lib/pin-rotation.mjs';
let result='BLOCKED',first='',second='';const input=process.stdin;
function hidden(prompt){return new Promise((done,reject)=>{let value='';const finish=()=>{input.removeListener('keypress',key);input.setRawMode(false);input.pause();process.stderr.write('\n');};const key=(text,k)=>{if(k?.ctrl&&k.name==='c'){finish();reject(Error());}else if(['return','enter'].includes(k?.name)){finish();done(value);}else if(['backspace','delete'].includes(k?.name))value=value.slice(0,-1);else if(text&&!k?.ctrl&&!k?.meta&&value.length<64)value+=text;};emitKeypressEvents(input);input.setRawMode(true);input.on('keypress',key);input.resume();process.stderr.write(prompt);});}
const normalize=s=>s.replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)>=0x6f0?0x6f0:0x660)));
try{
 const args=process.argv.slice(2);if(args.length!==3||args[0]!=='--owner-approved-pin-rotation'||!input.isTTY||!input.setRawMode)throw Error();
 const currentHash=await readPrivateFile(resolve(args[1]));
 first=normalize(await hidden('Enter NEW private PIN, 6-12 digits (hidden): '));second=normalize(await hidden('Confirm NEW private PIN (hidden): '));
 await preparePinRotation({currentHash,newPin:first,confirmation:second,output:resolve(args[2])});result='PREPARED';
}catch{/* Fail closed without disclosing private values or filesystem diagnostics. */}
finally{first='';second='';if(input.isRaw)input.setRawMode(false);input.pause();process.stdout.write(result+'\n');process.exitCode=result==='PREPARED'?0:2;}
