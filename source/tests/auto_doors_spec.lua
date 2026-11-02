local root = TEST_ROOT or '.'
local now, player, vehicle = 0, nil, nil
local resource, oxState = 'started', 1
local api, events, threads, messages = {}, {}, {}, {}
local exportTable = setmetatable({ ox_doorlock = { getDoor = function(_, id)
    assert(id == 7); return oxState == 'missing' and false or {state=oxState}
end } }, {__call=function(_, name, fn) api[name]=fn end})
local env = setmetatable({source=1, exports=exportTable, MloDoors={
    {group='garage',x=0,y=0,z=30,triggerX=0,triggerY=0,triggerZ=1,travel=3,speed=1,autoOpen=true,autoDistance=6,closeDelay=1},
    {group='pair',x=50,y=0,z=1,travel=4,speed=2,autoOpen=true,autoDistance=6,closeDelay=1},
    {group='pair',x=54,y=0,z=1,travel=4,speed=2,autoOpen=true,autoDistance=6,closeDelay=1},
    {group='legacy',x=0,y=0,z=1,travel=90,speed=90},
    {group='ox',x=100,y=0,z=1,travel=3,speed=1,autoOpen=true,autoDistance=6,closeDelay=1,oxDoorId=7}
}}, {__index=_G})
env.GetCurrentResourceName=function() return 'test' end
env.GetGameTimer=function() return now end
env.RegisterNetEvent=function(n,f) events[n]=f end
env.AddEventHandler=function() end
env.TriggerClientEvent=function(_,_,group,s) messages[#messages+1]={group=group,state=s} end
env.GetResourceState=function() return resource end
env.GetPlayers=function() return player and {'1'} or {} end
env.GetPlayerPed=function() return player and 101 or 0 end
env.GetAllVehicles=function() return vehicle and {202} or {} end
env.DoesEntityExist=function() return true end
env.GetEntityCoords=function(id) return id==101 and player or vehicle end
env.IsPlayerAceAllowed=function() return true end
env.CreateThread=function(fn) threads[#threads+1]=coroutine.create(fn) end
env.Wait=function() coroutine.yield() end
assert(loadfile(root..'/runtime/server_doors.lua','t',env))()
local function tick(ms) now=now+(ms or 500);local ok,err=coroutine.resume(threads[1]);assert(ok,err) end
local function pos(x) return {x=x,y=0,z=1} end
tick(); assert(not api.GetDoorOpen('garage')); assert(not api.GetDoorOpen('pair'))
player=pos(0);tick();assert(api.GetDoorOpen('garage'),'player must trigger at doorway, not top pivot')
assert(not api.GetDoorOpen('legacy'),'old config remains manual')
player=pos(7);tick();assert(api.GetDoorOpen('garage'),'hysteresis should hold open')
player=pos(10);tick(500);assert(api.GetDoorOpen('garage'),'close delay')
tick(500);assert(not api.GetDoorOpen('garage'),'close after clear delay')
player=nil;vehicle=pos(50);tick();assert(api.GetDoorOpen('pair'),'unoccupied vehicle must trigger gate')
local pairOpens=0;for _,m in ipairs(messages)do if m.group=='pair' and m.state.target==1 then pairOpens=pairOpens+1 end end
assert(pairOpens==1,'double leaves must have one transition')
vehicle=pos(57);tick();assert(api.GetDoorOpen('pair'),'second leaf holds shared group')
assert(api.SetDoorLocked('pair',true));assert(api.GetDoorLocked('pair'));assert(not api.GetDoorOpen('pair'))
assert(not api.SetDoorOpen('pair',true),'server export must respect lock');tick();assert(not api.GetDoorOpen('pair'))
player=pos(50);events['test:doors:request']('pair','open');assert(not api.GetDoorOpen('pair'),'ACE command cannot bypass lock')
assert(api.SetDoorLocked('pair',false));tick();assert(api.GetDoorOpen('pair'))
vehicle=nil;player=pos(100);tick();assert(not api.GetDoorOpen('ox'),'ox lock')
oxState=0;tick();assert(api.GetDoorOpen('ox'),'ox unlock')
oxState=true;tick();assert(not api.GetDoorOpen('ox'),'boolean ox lock')
oxState=false;tick();assert(api.GetDoorOpen('ox'),'boolean ox unlock')
resource='stopped';tick();assert(not api.GetDoorOpen('ox'),'missing provider fails closed')
resource='started';oxState='missing';tick();assert(api.GetDoorLocked('ox'),'unknown entry fails closed')
oxState=0;tick();assert(api.GetDoorOpen('ox'),'provider recovery')
assert(not api.SetDoorLocked('unknown',true));assert(not api.SetDoorLocked('garage',1))
assert(api.SetDoorLocked('ox',true));tick();assert(not api.GetDoorOpen('ox'),'local lock overrides ox unlock')
print('PASS: server proximity, player/vehicle auto open, paired state, delay, hysteresis, legacy opt-in, lock guards and ox provider failure/recovery')
