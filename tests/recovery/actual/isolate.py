import subprocess,json,pathlib,os,re
cfg=pathlib.Path(os.environ['BEITY_ACTUAL_RECOVERY_CONFIG']);assert cfg.is_absolute() and not cfg.is_symlink() and cfg.stat().st_mode&0o077==0 and cfg.stat().st_uid==os.getuid()
c=json.loads(cfg.read_text());P=pathlib.Path(c['workdir']);suffix=c['projectId'];assert re.fullmatch(r'beity-actual-recovery-[0-9]{8}(?:-[a-z0-9]+)?',suffix)
assert P.is_absolute() and P.is_dir() and P.stat().st_mode&0o077==0 and P.stat().st_uid==os.getuid()
assert not P.resolve().is_relative_to(pathlib.Path.cwd().resolve())
assert ('project_id = "'+suffix+'"') in (P/'recovery-new/supabase/config.toml').read_text()
assert not (P/'recovery-new/supabase/.temp/project-ref').exists()
def run(args):return subprocess.run(args,capture_output=True,text=True,check=True).stdout
names=run(['docker','ps','-a','--format','{{.Names}}']).splitlines();names=[n for n in names if n.startswith('supabase_') and n.endswith('_'+suffix)];assert len(names)==7
configs=json.loads(run(['docker','inspect',*names]));(P/'empty-container-config.private.json').write_text(json.dumps(configs));os.chmod(P/'empty-container-config.private.json',0o600)
# Only the new, empty, private recovery project may be rebuilt.
db='supabase_db_'+suffix
assert run(['docker','exec',db,'psql','-U','postgres','-At','-c','select count(*) from auth.users']).strip()=='0'
network='beity_actual_recovery_internal_'+suffix.replace('beity-actual-recovery-','');run(['docker','network','create','--internal',network])
run(['docker','stop',*names]);run(['docker','rm',*names])
for c in configs:
 name=c['Name'].lstrip('/');env=P/(name+'.env');env.write_text('\n'.join(c['Config']['Env'])+'\n');os.chmod(env,0o600)
 image=c['Config']['Image']
 if name.startswith('supabase_auth_'):image='public.ecr.aws/supabase/gotrue:v2.197.0'
 if name.startswith('supabase_storage_'):image='public.ecr.aws/supabase/storage-api:v1.80.2'
 args=['docker','create','--name',name,'--network',network,'--env-file',str(env),'--log-driver','none']
 for net in c['NetworkSettings']['Networks'].values():
  for alias in net.get('Aliases') or []:args+=['--network-alias',alias]
 for m in c['Mounts']:
  v=('type=volume,source='+m['Name'] if m['Type']=='volume' else 'type=bind,source='+m['Source'])+',target='+m['Destination']
  if not m['RW']:v+=',readonly'
  args+=['--mount',v]
 for port,bindings in (c['HostConfig']['PortBindings'] or {}).items():
  for b in bindings:args+=['-p','127.0.0.1:'+b['HostPort']+':'+port]
 if c['Config'].get('User'):args+=['--user',c['Config']['User']]
 if c['Config'].get('WorkingDir'):args+=['--workdir',c['Config']['WorkingDir']]
 ep=c['Config'].get('Entrypoint') or []
 if ep:args+=['--entrypoint',ep[0]]
 args+=[image]+ep[1:]+(c['Config'].get('Cmd') or [])
 run(args)
order=sorted(names,key=lambda n:0 if n.startswith('supabase_db_') else 1);run(['docker','start',*order])
checks=json.loads(run(['docker','inspect',*names]));assert all(c['HostConfig']['LogConfig']['Type']=='none' for c in checks)
assert all(all(b['HostIp']=='127.0.0.1' for b in v) for c in checks for v in (c['HostConfig']['PortBindings'] or {}).values())
assert all(list(c['NetworkSettings']['Networks'])==[network] for c in checks)
assert json.loads(run(['docker','network','inspect',network]))[0]['Internal']
(P/'isolation-check.json').write_text(json.dumps({'containers':len(names),'internalNetwork':True,'loopbackPortsOnly':True,'loggingDisabled':True,'actualDataImported':False},indent=2))
print('PASS: seven empty recovery services recreated with internal networking, loopback-only ports and disabled logging')
