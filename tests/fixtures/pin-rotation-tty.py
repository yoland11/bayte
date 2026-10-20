import os,pty,subprocess,sys,select,time,json
f=json.load(open(sys.argv[1]));master,slave=pty.openpty()
p=subprocess.Popen(['node','scripts/prepare-pin-rotation.mjs','--owner-approved-pin-rotation',f['existingHash'],f['output']],stdin=slave,stderr=slave,stdout=subprocess.PIPE)
os.close(slave);seen=b'';out=b'';sent=0;deadline=time.monotonic()+15
while time.monotonic()<deadline and p.poll() is None:
 ready,_,_=select.select([master,p.stdout],[],[],.1)
 for fd in ready:
  try:data=os.read(fd if isinstance(fd,int) else fd.fileno(),65536)
  except OSError:data=b''
  if fd==master:seen+=data
  else:out+=data
 if sent<2 and seen.count(b'(hidden)')>sent:os.write(master,f['pin'].encode()+b'\r');sent+=1
if p.poll() is None:p.kill()
out+=p.communicate()[0];os.close(master)
print(json.dumps({'status':out.decode().strip(),'inputSentTwice':sent==2,'secretEchoed':f['pin'].encode() in seen+out,'exit':p.returncode}))
