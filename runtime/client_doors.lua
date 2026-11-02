local event = GetCurrentResourceName() .. ':doors:'
local states, objects, pending, failures = {}, {}, {}, {}
local latency = 0
local function apply(group, s, age)
    if states[group] and s.revision < states[group].revision then return end
    s.received = GetGameTimer() - (age or latency)
    states[group] = s
end
RegisterNetEvent(event .. 'state', function(group, s)
    if source ~= 65535 then return end
    apply(group, s)
end)
RegisterNetEvent(event .. 'snapshot', function(token, rows)
    if source ~= 65535 or not pending[token] then return end
    latency = math.max(0, math.min(1000, (GetGameTimer() - pending[token]) / 2))
    pending[token] = nil
    for group, s in pairs(rows) do apply(group, s, latency) end
end)
local function ratio(s)
    local t = s.duration <= 0 and 1 or math.min(1, math.max(0, (GetGameTimer() - s.received) / s.duration))
    return s.from + (s.target - s.from) * t
end
local function place(d, obj, r)
    local travel = d.travel * d.direction * r
    if d.native then
        -- The original asset origin differs from our selected hinge/top pivot.
        -- Rotate that local offset along with the same collision-bearing object.
        local yaw = math.rad(d.heading + (d.kind == 'hinged' and travel or 0))
        local pitch = d.kind == 'tilt' and math.rad(travel) or 0
        local cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
        local ox = d.originX
        local oy, oz = d.originY * cp - d.originZ * sp, d.originY * sp + d.originZ * cp
        local back = d.kind == 'tilt' and (d.tiltOffset or 0) * r or 0
        local lift = d.kind == 'tilt' and (d.tiltLift or 0) * r or 0
        SetEntityCoordsNoOffset(obj, d.x + d.dx * travel + cy * ox - sy * oy - math.sin(math.rad(d.heading)) * back,
            d.y + d.dy * travel + sy * ox + cy * oy + math.cos(math.rad(d.heading)) * back,
            d.z + d.dz * travel + oz + lift, false, false, false)
        local sz, cz, sx, cx = math.sin(yaw/2), math.cos(yaw/2), math.sin(pitch/2), math.cos(pitch/2)
        SetEntityQuaternion(obj, cz*sx, sz*sx, sz*cx, cz*cx)
        return
    end
    if d.kind == 'tilt' then
        -- Tilt assets are baked in width/depth/up axes about the TOP edge.
        -- q = world heading * local width-axis rotation. Moving the same entity
        -- transforms its embedded collision along with the visible geometry.
        local yaw, pitch = math.rad(d.heading), math.rad(travel)
        local offset, lift = (d.tiltOffset or 0) * r, (d.tiltLift or 0) * r
        local sz, cz = math.sin(yaw / 2), math.cos(yaw / 2)
        local sx, cx = math.sin(pitch / 2), math.cos(pitch / 2)
        SetEntityCoordsNoOffset(obj, d.x - math.sin(yaw) * offset, d.y + math.cos(yaw) * offset, d.z + lift, false, false, false)
        SetEntityQuaternion(obj, cz * sx, sz * sx, sz * cx, cz * cx)
        return
    end
    SetEntityCoordsNoOffset(obj, d.x + d.dx * travel, d.y + d.dy * travel, d.z + d.dz * travel, false, false, false)
    SetEntityHeading(obj, d.heading + (d.kind == 'hinged' and travel or 0))
end
CreateThread(function()
    while true do
        local token = GetGameTimer()
        pending = { [token] = token }
        TriggerServerEvent(event .. 'sync', token)
        Wait(5000)
    end
end)
CreateThread(function()
    while true do
        local pos, active = GetEntityCoords(PlayerPedId()), false
        for _, d in ipairs(MloDoors) do
            local distance = (pos.x - d.x)^2 + (pos.y - d.y)^2 + (pos.z - d.z)^2
            -- Keep the whole travel path in range, including unusually long gates.
            local range = 150 + ((d.kind == 'hinged' or d.kind == 'tilt') and 0 or d.travel)
                + math.abs(d.tiltLift or 0) + math.abs(d.tiltOffset or 0) + (d.height or 0)
            local obj, s = objects[d.id], states[d.group]
            if obj and not DoesEntityExist(obj) then objects[d.id] = nil; obj = nil end
            if distance < range * range then
                active = true
                if s and not obj then
                    local hash = joaat(d.model)
                    RequestModel(hash)
                    RequestCollisionForModel(hash)
                    if HasModelLoaded(hash) and (not d.collision or HasCollisionForModelLoaded(hash)) then
                        obj = CreateObjectNoOffset(hash, d.x, d.y, d.z, false, false, false)
                        if obj ~= 0 then
                            SetEntityAsMissionEntity(obj, true, true)
                            FreezeEntityPosition(obj, true)
                            SetEntityInvincible(obj, true)
                            place(d, obj, ratio(s))
                            SetEntityCollision(obj, d.collision, true)
                            objects[d.id] = obj
                            SetModelAsNoLongerNeeded(hash)
                        else obj = nil end
                    elseif not failures[d.id] then
                        failures[d.id] = GetGameTimer()
                    elseif GetGameTimer() - failures[d.id] > 10000 then
                        print(('MLO door %s: model/collision not loaded; check stream assets'):format(d.id))
                        failures[d.id] = GetGameTimer()
                    end
                end
                if obj and s then place(d, obj, ratio(s)) end
            elseif obj then DeleteEntity(obj); objects[d.id] = nil end
        end
        Wait(active and 0 or 250)
    end
end)
RegisterCommand('mlodoor', function(_, args)
    if args[1] and (args[2] == 'open' or args[2] == 'close' or args[2] == 'toggle') then
        TriggerServerEvent(event .. 'request', args[1], args[2])
    else print('Usage: /mlodoor <group from doors.lua> open|close|toggle (requires ACE mlo.doors)') end
end, false)
AddEventHandler('onResourceStop', function(name)
    if name ~= GetCurrentResourceName() then return end
    for _, obj in pairs(objects) do if DoesEntityExist(obj) then DeleteEntity(obj) end end
end)
