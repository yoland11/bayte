import os,pty,subprocess,sys,select,time,json,pathlib
fixture=json.load(open(sys.argv[1]));master,slave=pty.openpty()
# Isolate the operator CWD: never depend on the developer production link.
original=pathlib.Path.cwd();cwd=pathlib.Path(sys.argv[1]).resolve().parent/'isolated-project';cwd.mkdir(exist_ok=True)
(cwd/'supabase/.temp').mkdir(parents=True,exist_ok=True)
(cwd/'supabase/.temp/project-ref').write_text('irnwbayhxawphkxmbnbx')
if not (cwd/'scripts').exists():(cwd/'scripts').symlink_to(original/'scripts',target_is_directory=True)
p=subprocess.Popen(['node','scripts/verify-production-credentials.mjs',fixture.get('mode','password')]+fixture.get('flags',[]),stdin=slave,stderr=slave,stdout=subprocess.PIPE,cwd=cwd,env={**os.environ,'PATH':fixture['bin']+os.pathsep+os.environ['PATH'],'BEITY_OPERATOR_STATE_DIR':fixture['stateDir']})
os.close(slave);seen=b'';out=b'';sent=0;responses=fixture.get('responses',[fixture['candidate']]);deadline=time.monotonic()+12
while time.monotonic()<deadline and p.poll() is None:
 ready,_,_=select.select([master,p.stdout],[],[],.1)
 for fd in ready:
  try:data=os.read(fd if isinstance(fd,int) else fd.fileno(),65536)
  except OSError:data=b''
  if fd==master:seen+=data
  else:out+=data
 if sent<len(responses) and (seen+out).count(b'(hidden)')>sent:
  os.write(master,responses[sent].encode()+b'\r');sent+=1
if p.poll() is None:p.kill()
out+=p.communicate()[0];os.close(master)
print(json.dumps({'status':out.decode().strip(),'inputSent':sent>0,'secretEchoed':fixture['candidate'].encode() in seen+out,'hashEchoed':fixture['hash'].encode() in seen+out,'exit':p.returncode}))
