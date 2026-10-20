"""Read-only Git-object audit. Outputs locations/types only, never matched data.
Usage: python3 scripts/audit-git-exposure.py OUTPUT_JSON [PRIVATE_KNOWN_FILES_JSON]
Private config: [{"type":"service-role key","path":"/private/file"}, ...].
All loose/packed objects are inspected, including unreachable objects. No network.
"""
import subprocess,json,re,sys,base64,pathlib,math,collections,os

def git(*args):return subprocess.check_output(['git',*args],stderr=subprocess.DEVNULL)
objects=[x.split() for x in git('cat-file','--batch-all-objects','--batch-check=%(objectname) %(objecttype)').decode().splitlines()]
commits=[oid for oid,t in objects if t=='commit'];paths=collections.defaultdict(set)
for oid in commits:
 for row in git('ls-tree','-r','-z',oid).split(b'\0'):
  if b'\t' not in row:continue
  meta,p=row.split(b'\t',1);parts=meta.split()
  if len(parts)==3:paths[parts[2].decode()].add(p.decode('utf8','replace'))
known=[]
if len(sys.argv)>2:
 cfg=pathlib.Path(sys.argv[2]);assert cfg.stat().st_uid==os.getuid() and cfg.stat().st_mode&0o077==0
 for x in json.loads(cfg.read_text()):
  f=pathlib.Path(x['path']);assert f.stat().st_uid==os.getuid() and f.stat().st_mode&0o077==0
  data=f.read_bytes();data=str(json.loads(data)[x['jsonField']]).encode() if x.get('jsonField') else data;data=data if x.get('binary') else data.strip()
  if len(data)>=16:
   known.append((x['type'],data))
   if x.get('binary'):
    for encoded in [data.hex().encode(),base64.b64encode(data),base64.urlsafe_b64encode(data).rstrip(b'=')]:known.append((x['type'],encoded))
patterns=[
 ('PIN literal',rb'(?i)(?:DEFAULT_PIN|APP_PIN|LOGIN_PIN|\bPIN)\s*(?:=|:)\s*[\x22\x27]?([0-9]{4,12})\b','hardcoded PIN candidate; compare privately with approved hash before declaring live exposure'),
 ('database credential',rb'(?i)(?:postgres(?:ql)?|mysql)://[^\s:/]+:([^\s@]+)@','review literal credential; placeholders are not live credentials'),
 ('privileged Supabase key',rb'\bsb_secret_[A-Za-z0-9_-]{15,}','potential live privileged credential'),
 ('Supabase management token',rb'\bsbp_[A-Za-z0-9]{20,}','potential live API token'),
 ('GitHub API token',rb'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})','potential live API token'),
 ('API token',rb'\b(?:sk_live_|sk-proj-|vcp_)[A-Za-z0-9_-]{16,}','potential live API token'),
 ('private key',rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----','private key material'),
 ('credential literal',rb'(?i)(?:password|passwd|service_role_key|api_secret|recovery_key|rate_limit_secret|api_token|access_token)\s*[=:]\s*[\x22\x27]([^\x22\x27\r\n]{6,})[\x22\x27]','review: may be synthetic/placeholder'),
]
findings=[];publickeys=0;counts=collections.Counter()
for oid,typ in objects:
 if typ not in ['blob','commit','tag']:continue
 data=git('cat-file',typ,oid);counts[typ]+=1
 def note(kind,pos,confidence):
  findings.append({'type':kind,'object':oid,'locations':sorted(paths.get(oid,{typ+' object'})),'line':data[:pos].count(b'\n')+1,'classification':confidence})
 for kind,value in known:
  if value in data:note(kind,data.index(value),'exact match to independently held private credential')
 if b'\0' in data:continue
 for kind,pattern,confidence in patterns:
  for m in re.finditer(pattern,data):note(kind,m.start(),confidence)
 for m in re.finditer(rb'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',data):
  try:
   encoded=m.group().split(b'.')[1];claims=json.loads(base64.urlsafe_b64decode(encoded+b'='*((-len(encoded))%4)));role=claims.get('role')
   if role=='service_role':note('Supabase service-role JWT',m.start(),'privileged key material; validity not probed')
   elif role=='anon':publickeys+=1
   elif claims.get('session_id') or claims.get('sub'):note('authenticated access JWT',m.start(),'session token; validity not probed')
  except Exception:pass
result={'scope':'all locally available Git objects after fetching all configured remotes/tags; includes unreachable objects, commit/tag messages and every historical blob','objectCounts':dict(counts),'commits':len(commits),'findings':findings,'publicAnonJwtOccurrencesNotClassifiedAsSecrets':publickeys,'knownCredentialFilesCompared':len(known),'secretValuesPrinted':False,'limitations':['Pattern/known-value detection cannot prove absence of arbitrary unknown secrets or external forks/caches/CI artifacts.','Provider validity was not probed; placeholders require review.','GitHub PR-only refs not advertised/fetched and server-deleted objects are outside the local object database.']}
pathlib.Path(sys.argv[1]).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'commitsScanned':len(commits),'blobCount':counts['blob'],'findings':len(findings),'secretValuesPrinted':False}))
