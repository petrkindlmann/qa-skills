from pathlib import Path
import datetime, json, os, shlex, subprocess, sys, time
root=Path(__file__).resolve().parent.parent
evidence=root/'evidence'
name,*command=sys.argv[1:]
start=datetime.datetime.now(datetime.timezone.utc).isoformat()
clock=time.monotonic()
result=subprocess.run(command,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=180)
metadata={'command':command,'shellCommand':shlex.join(command),'cwd':str(root),'startedAt':start,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'durationSeconds':round(time.monotonic()-clock,3),'exitCode':result.returncode,'capturedBytes':len(result.stdout.encode())}
(evidence/(name+'.log')).write_text(result.stdout)
(evidence/(name+'.json')).write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2))
print(result.stdout)
sys.exit(result.returncode)
