"""Throwaway validation of DESIGN-DECISIONS numbers. Not the real engine."""
import random, statistics, sys
HEAD_ON_RULE='draw'
W=H=24; SIM_HZ=120; ROUND=90.0; SPEED=6.0; START_LEN=4; FOOD=4
LASER_START=30.0; WARN=5.0; STEP=2.5; MIN_ARENA=6
DIRS={'U':(0,1),'D':(0,-1),'L':(-1,0),'R':(1,0)}; OPP={'U':'D','D':'U','L':'R','R':'L'}

class Snake:
    def __init__(s, cells, d): s.seg=list(cells); s.d=d; s.q=[]; s.grow=0; s.acc=0.0; s.alive=True
    def queue(s, d):
        last = s.q[-1] if s.q else s.d
        if d==last or OPP[d]==last or len(s.q)>=2: return
        s.q.append(d)
    def next_head(s):
        d = s.q[0] if s.q else s.d
        return (s.seg[0][0]+DIRS[d][0], s.seg[0][1]+DIRS[d][1])
    def commit(s):
        if s.q: s.d=s.q.pop(0)
        s.seg.insert(0, (s.seg[0][0]+DIRS[s.d][0], s.seg[0][1]+DIRS[s.d][1]))
        if s.grow>0: s.grow-=1
        else: s.seg.pop()

class Round:
    def __init__(s, seed, bots):
        s.rng=random.Random(seed); s.t=ROUND; s.inset=0; s.next_step=None; s.warned=False; s.stopped=False
        s.s=[Snake([(5-i,12) for i in range(START_LEN)],'R'), Snake([(18+i,11) for i in range(START_LEN)],'L')]
        s.bots=bots; s.apples=set(); s.events=[]
        for _ in range(FOOD): s.spawn_apple()
        s.result=None; s.cause=[None,None]
    def safe(s,c): return s.inset<=c[0]<W-s.inset and s.inset<=c[1]<H-s.inset
    def spawn_apple(s):
        occ={c for sn in s.s for c in sn.seg}|s.apples; heads=[sn.seg[0] for sn in s.s]
        free=[(x,y) for x in range(s.inset,W-s.inset) for y in range(s.inset,H-s.inset)
              if (x,y) not in occ and all(max(abs(x-h[0]),abs(y-h[1]))>=2 for h in heads)]
        s.apples.add(s.rng.choice(free))
    def run(s):
        dt=1/SIM_HZ
        while s.result is None:
            s.t-=dt
            if not s.warned and s.t<=LASER_START: s.warned=True; s.next_step=LASER_START-WARN; s.events.append(('WARN',round(ROUND-s.t,3)))
            if s.next_step is not None and not s.stopped and s.t<=s.next_step:
                s.inset+=1; s.events.append(('STEP',s.inset,round(ROUND-s.t,3))); s.next_step-=STEP
                if W-2*s.inset<=MIN_ARENA: s.stopped=True
                for i,sn in enumerate(s.s):
                    if sn.alive and not s.safe(sn.seg[0]): sn.alive=False; s.cause[i]='LASER'
                for a in [a for a in s.apples if not s.safe(a)]: s.apples.discard(a); s.spawn_apple()
                if s.finish(): break
            due=[]
            for i,sn in enumerate(s.s):
                if not sn.alive: continue
                sn.acc+=dt*SPEED
                if sn.acc>=1: sn.acc-=1; due.append(i)
            if due:
                for i in due: s.bots[i](s,i)
                nh={i:s.s[i].next_head() for i in due}
                for i in due:
                    sn=s.s[i]; h=nh[i]
                    if not s.safe(h): sn.alive=False; s.cause[i]='WALL' if s.inset==0 else 'LASER'; continue
                    own=sn.seg[:-1] if sn.grow==0 else sn.seg
                    if h in own: sn.alive=False; s.cause[i]='SELF'; continue
                    o=s.s[1-i]; oh=nh.get(1-i)
                    obody = o.seg if (1-i) not in nh else o.seg[:-1] if o.grow==0 else o.seg
                    if (1-i) in nh and (h==oh or (h==o.seg[0] and oh==sn.seg[0])):
                        if HEAD_ON_RULE=='longer' and len(sn.seg)>len(o.seg): pass
                        else: sn.alive=False; s.cause[i]='HEAD_ON'
                        continue
                    if h in obody or ((1-i) not in nh and h==o.seg[0]): sn.alive=False; s.cause[i]='BODY'; continue
                for i in due:
                    if s.s[i].alive:
                        s.s[i].commit()
                        if s.s[i].seg[0] in s.apples: s.apples.discard(s.s[i].seg[0]); s.s[i].grow+=1; s.spawn_apple()
                if s.finish(): break
            if s.t<=0:
                l=[len(x.seg) for x in s.s]; s.result='DRAW' if l[0]==l[1] else ('P1' if l[0]>l[1] else 'P2'); s.end='TIMEOUT'; break
        return s
    def finish(s):
        a=[x.alive for x in s.s]
        if all(a): return False
        s.result='DRAW' if not any(a) else ('P1' if a[0] else 'P2'); s.end=('PRE' if s.t>LASER_START else 'LASER'); return True

def noop(r,i): pass
def survivor(r,i, look=2):
    sn=r.s[i]; best=None
    for d in ['U','D','L','R']:
        if OPP[d]==sn.d: continue
        h=(sn.seg[0][0]+DIRS[d][0], sn.seg[0][1]+DIRS[d][1])
        if not r.safe(h) or h in sn.seg or h in r.s[1-i].seg: continue
        oh=r.s[1-i].seg[0]; threat = r.s[1-i].alive and abs(h[0]-oh[0])+abs(h[1]-oh[1])<=1
        # 2-step lookahead: count free neighbours
        free=sum(1 for d2 in DIRS.values() if r.safe((h[0]+d2[0],h[1]+d2[1])) and (h[0]+d2[0],h[1]+d2[1]) not in sn.seg and (h[0]+d2[0],h[1]+d2[1]) not in r.s[1-i].seg)
        # prefer near future safety, small margin from lasers, randomness
        score=free*10 + (3 if d==sn.d else 0) + r.rng.random() - (25 if threat else 0)
        if r.next_step is not None: score -= 4*max(0, 3-min(h[0]-r.inset, W-1-r.inset-h[0], h[1]-r.inset, H-1-r.inset-h[1]))
        if best is None or score>best[0]: best=(score,d)
    if best and best[1]!=sn.d: sn.q=[best[1]]
def greedy(r,i):
    sn=r.s[i]; h0=sn.seg[0]; tgt=min(r.apples, key=lambda a: abs(a[0]-h0[0])+abs(a[1]-h0[1]))
    best=None
    for d in ['U','D','L','R']:
        if OPP[d]==sn.d: continue
        h=(h0[0]+DIRS[d][0], h0[1]+DIRS[d][1])
        if not r.safe(h) or h in sn.seg or h in r.s[1-i].seg: continue
        free=sum(1 for d2 in DIRS.values() if r.safe((h[0]+d2[0],h[1]+d2[1])) and (h[0]+d2[0],h[1]+d2[1]) not in sn.seg and (h[0]+d2[0],h[1]+d2[1]) not in r.s[1-i].seg)
        if free==0: continue
        oh=r.s[1-i].seg[0]; threat = r.s[1-i].alive and abs(h[0]-oh[0])+abs(h[1]-oh[1])<=1
        score=-(abs(tgt[0]-h[0])+abs(tgt[1]-h[1])) + r.rng.random()*0.5 - (30 if threat else 0)
        if best is None or score>best[0]: best=(score,d)
    if best and best[1]!=sn.d: sn.q=[best[1]]

def report(name, bots, n=300):
    ends={'PRE':0,'LASER':0,'TIMEOUT':0}; draws=0; lens=[]; causes={}
    for seed in range(n):
        r=Round(seed,bots).run(); ends[r.end]+=1; draws+=r.result=='DRAW'; lens.append(max(len(x.seg) for x in r.s))
        for c in r.cause:
            if c: causes[c]=causes.get(c,0)+1
    print(f"{name:22s} pre-laser {ends['PRE']/n:5.0%}  during-laser {ends['LASER']/n:5.0%}  timeout {ends['TIMEOUT']/n:5.0%}  draws {draws/n:5.1%}  mean max len {statistics.mean(lens):4.1f}  causes {causes}")

# 1. no-input round
r=Round(1,[noop,noop]).run()
print("no-input round:", r.result, r.end, "cause", r.cause, "at t=%.3f s"%(ROUND-r.t), "(expected DRAW, WALL/WALL, 3.167 s)")
# 2. laser timeline with immortal-ish snakes: use survivor bots, print events of one round
r=Round(7,[survivor,survivor]).run(); ev=[e for e in r.events if e[0] in ('WARN','STEP')]
print("laser events (elapsed s):", ev)
print("final inset", r.inset, "-> safe square", W-2*r.inset, "x", H-2*r.inset, "stopped", r.stopped)
# 3. bots
for rule in ('draw','longer'):
    HEAD_ON_RULE=rule; print("--- head-on rule:", rule, "(head-avoiding bots) ---")
    report("survivor vs survivor", [survivor,survivor])
    report("greedy vs survivor", [greedy,survivor])
    report("greedy vs greedy", [greedy,greedy])
import sys; sys.exit()
report("survivor vs survivor", [survivor,survivor])
report("greedy vs survivor", [greedy,survivor])
report("greedy vs greedy", [greedy,greedy])
