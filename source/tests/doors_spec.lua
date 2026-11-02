local root = TEST_ROOT or '.'
local function near(a, b) assert(math.abs(a - b) < 0.001, tostring(a) .. ' ~= ' .. tostring(b)) end
local doors = {
    {id='a', group='pair', model='a', kind='sliding', x=10,y=20,z=30,heading=90,dx=0,dy=1,dz=0,direction=1,travel=4,speed=2,collision=true},
    {id='b', group='pair', model='b', kind='sliding', x=12,y=20,z=30,heading=90,dx=0,dy=1,dz=0,direction=-1,travel=4,speed=2,collision=true},
    {id='g', group='garage', model='g', kind='garage', x=0,y=0,z=0,heading=0,dx=0,dy=0,dz=1,direction=1,travel=3,speed=1,collision=true},
    {id='h', group='hinge', model='h', kind='hinged', x=0,y=0,z=0,heading=20,dx=0,dy=0,dz=0,direction=-1,travel=90,speed=90,collision=false},
    {id='t', group='tilt', model='t', kind='tilt', x=50,y=20,z=33,heading=90,dx=0,dy=0,dz=0,direction=1,travel=90,speed=30,collision=true,tiltLift=1,tiltOffset=-2,height=3}
}
local now, events, handlers, api, messages = 0, {}, {}, {}, {}
local allowed, playerPosition = true, {x=10,y=20,z=30}
local server = setmetatable({MloDoors=doors, source=1}, {__index=_G})
server.GetCurrentResourceName=function() return 'test' end
server.GetGameTimer=function() return now end
server.RegisterNetEvent=function(n,f) events[n]=f end
server.AddEventHandler=function(n,f) handlers[n]=f end
server.exports=function(n,f) api[n]=f end
server.TriggerClientEvent=function(n,target,...) messages[#messages+1]={name=n,target=target,args={...}} end
server.IsPlayerAceAllowed=function() return allowed end
server.GetPlayerPed=function() return 1 end
server.GetEntityCoords=function() return playerPosition end
server.CreateThread=function() end
assert(loadfile(root .. '/runtime/server_doors.lua','t',server))()
local function request(group, action) events['test:doors:request'](group,action) end
allowed=false; request('pair','open'); assert(not api.GetDoorOpen('pair'))
now=400; allowed=true; playerPosition={x=999,y=999,z=999}; request('pair','open'); assert(not api.GetDoorOpen('pair'))
now=800; playerPosition={x=10,y=20,z=30}; request('pair','open'); assert(api.GetDoorOpen('pair'))
request('pair','close'); assert(api.GetDoorOpen('pair'), 'rate limit')
assert(not api.SetDoorOpen('invalid',true)); assert(not api.SetDoorOpen('pair',1))
now=1800; events['test:doors:sync'](7)
local half=messages[#messages].args[2].pair; near(half.from,0.5); near(half.duration,1000)
assert(api.SetDoorOpen('pair',false)); local reversal=messages[#messages].args[2]; near(reversal.from,0.5); near(reversal.duration,1000)
now=3800; events['test:doors:sync'](8); near(messages[#messages].args[2].pair.from,0)
assert(api.SetDoorOpen('garage',true)); assert(api.SetDoorOpen('hinge',true))
assert(api.SetDoorOpen('tilt',true))
now=5300; events['test:doors:sync'](9)
local rows=messages[#messages].args[2]; near(rows.garage.from,0.5); near(rows.hinge.from,1)

local function client()
    local ev, callbacks, threads, entities, clock = {}, {}, {}, {}, now
    local position={x=10,y=20,z=30}
    local env=setmetatable({MloDoors=doors,source=65535}, {__index=_G})
    env.GetCurrentResourceName=server.GetCurrentResourceName
    env.GetGameTimer=function() return clock end
    env.RegisterNetEvent=function(n,f) ev[n]=f end
    env.AddEventHandler=function(n,f) callbacks[n]=f end
    env.CreateThread=function(f) threads[#threads+1]=coroutine.create(f) end
    env.Wait=function() coroutine.yield() end
    local requestedToken
    env.TriggerServerEvent=function(_,token) requestedToken=token end
    env.GetEntityCoords=function() return position end
    env.PlayerPedId=function() return 1 end
    env.joaat=function(s) return s end
    env.RequestModel=function() end; env.RequestCollisionForModel=function() end
    env.HasModelLoaded=function() return true end; env.HasCollisionForModelLoaded=function() return true end
    env.CreateObjectNoOffset=function(hash,x,y,z,networked)
        assert(not networked,'must not create competing network owners')
        local obj={model=hash}; entities[#entities+1]=obj; return obj
    end
    env.DoesEntityExist=function(o) return not o.deleted end
    env.FreezeEntityPosition=function(o,v) o.frozen=v end
    env.SetEntityInvincible=function() end; env.SetEntityAsMissionEntity=function() end
    env.SetEntityCoordsNoOffset=function(o,x,y,z) o.x=x;o.y=y;o.z=z end
    env.SetEntityHeading=function(o,h) o.heading=h end
    env.SetEntityQuaternion=function(o,x,y,z,w) o.q={x,y,z,w} end
    env.SetEntityCollision=function(o,v) o.collision=v end
    env.SetModelAsNoLongerNeeded=function() end
    env.DeleteEntity=function(o) o.deleted=true end
    env.RegisterCommand=function() end
    assert(loadfile(root .. '/runtime/client_doors.lua','t',env))()
    local function tick() local ok,err=coroutine.resume(threads[2]); assert(ok,err) end
    assert(coroutine.resume(threads[1])); assert(requestedToken)
    local copy={}; for group,s in pairs(rows) do copy[group]={}; for k,v in pairs(s) do copy[group][k]=v end end
    ev['test:doors:snapshot'](requestedToken,copy)
    tick()
    return {entities=entities, events=ev, tick=tick, advance=function(ms) clock=clock+ms end, far=function() position={x=1000,y=1000,z=1000} end, home=function() position={x=10,y=20,z=30} end, stop=function() callbacks.onResourceStop('test') end}
end
local a,b=client(),client()
for i,o in ipairs(a.entities) do
    local other=b.entities[i]; near(o.x,other.x);near(o.y,other.y);near(o.z,other.z);assert(o.frozen)
    if o.model=='g' then near(o.z,1.5);assert(o.collision) end
    if o.model=='h' then near(o.heading,-70);assert(o.collision==false) end
    if o.model=='t' then
        near(o.x,51);near(o.y,20);near(o.z,33.5);assert(o.collision)
        near(o.q[1],math.cos(math.pi/4)*math.sin(math.pi/8))
        near(o.q[2],o.q[1]);near(o.q[3],math.sin(math.pi/4)*math.cos(math.pi/8))
        for k=1,4 do near(o.q[k],other.q[k]) end
    end
end
a.advance(1500); b.advance(1500); a.tick();b.tick()
near(a.entities[3].z,3); near(b.entities[3].z,3)
a.far();a.tick();assert(a.entities[3].deleted)
a.home();a.tick();near(a.entities[8].z,3);assert(a.entities[8].collision)
-- Stale state must not rewind a newer revision.
a.events['test:doors:state']('garage',{from=0,target=0,duration=0,revision=0});a.tick();near(a.entities[8].z,3)
local tilt=a.entities[10];near(tilt.x,52);near(tilt.z,34)
-- The top-pivot box centre (0,0,-1.5) must end horizontal, extending toward -X.
local q=tilt.q;local vx,vy,vz=0,0,-1.5
local tx,ty,tz=2*(q[2]*vz-q[3]*vy),2*(q[3]*vx-q[1]*vz),2*(q[1]*vy-q[2]*vx)
near(tilt.x+vx+q[4]*tx+(q[2]*tz-q[3]*ty),50.5)
near(tilt.z+vz+q[4]*tz+(q[1]*ty-q[2]*tx),34)
a.events['test:doors:state']('tilt',{from=1,target=0,duration=1000,revision=2})
a.advance(500);a.tick();near(tilt.x,51);near(tilt.z,33.5)
a.advance(500);a.tick();near(tilt.x,50);near(tilt.z,33)
near(tilt.q[1],0);near(tilt.q[2],0);near(tilt.q[3],math.sin(math.pi/4));near(tilt.q[4],math.cos(math.pi/4))
a.stop();b.stop(); for _,o in ipairs(a.entities) do assert(o.deleted) end
print('PASS: permissions, proximity, rate limit, reversal, late join, paired state, two clients, transforms, collision calls, stream-in and cleanup')

-- Original models have an origin offset from the editor's selected pivot.
for i,kind in ipairs({'hinged','garage','sliding','tilt'}) do
    doors[5+i]={id='native'..i,group='native'..i,model='native'..i,native=true,kind=kind,x=10,y=20,z=30,heading=0,originX=-1,originY=-.5,originZ=-2,dx=kind=='sliding' and 1 or 0,dy=0,dz=kind=='garage' and 1 or 0,direction=1,travel=90,speed=1,collision=true}
    doors[5+i].travel=(kind=='hinged' or kind=='tilt') and 90 or 3
    rows['native'..i]={from=0,target=1,duration=1000,revision=1}
end
local n1,n2=client(),client()
for i=6,9 do local p,q=n1.entities[i],n2.entities[i];near(p.x,9);near(p.y,19.5);near(p.z,28);assert(p.collision);near(p.x,q.x);near(p.z,q.z) end
n1.advance(1000);n2.advance(1000);n1.tick();n2.tick()
near(n1.entities[6].x,10.5);near(n1.entities[6].y,19);near(n1.entities[6].z,28)
near(n1.entities[7].x,9);near(n1.entities[7].z,31)
near(n1.entities[8].x,12);near(n1.entities[8].z,28)
near(n1.entities[9].x,9);near(n1.entities[9].y,22);near(n1.entities[9].z,29.5)
for i=6,9 do local p,q=n1.entities[i],n2.entities[i];near(p.x,q.x);near(p.y,q.y);near(p.z,q.z);assert(p.collision) end
n1.stop();n2.stop()
print('PASS: native origin offsets for hinged, lift, slide and tilt; two clients and moving entity collision calls')
