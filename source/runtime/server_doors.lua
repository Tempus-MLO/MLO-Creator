-- Authoritative state, independent of entity ownership. Local collision objects are
-- recreated from this state on each client; there is no migratable network prop.
local event = GetCurrentResourceName() .. ':doors:'
local groups, states, requests, snapshots = {}, {}, {}, {}
local locks, lastNear, lockWarnings = {}, {}, {}
local hasAuto = false
for _, d in ipairs(MloDoors) do
    groups[d.group] = groups[d.group] or {}
    table.insert(groups[d.group], d)
    states[d.group] = { from = 0, target = 0, started = GetGameTimer(), duration = 0, revision = 0 }
    hasAuto = hasAuto or d.autoOpen == true
end
local function isLocked(group)
    if not groups[group] then return true end
    if locks[group] then return true end
    for _, d in ipairs(groups[group]) do
        if (d.oxDoorId or 0) > 0 then
            local ok, door = false, nil
            if GetResourceState('ox_doorlock') == 'started' then
                ok, door = pcall(function() return exports.ox_doorlock:getDoor(d.oxDoorId) end)
            end
            -- Missing/stopped lock provider or an unknown ID must never unlock a gate.
            if not ok or type(door) ~= 'table' or (door.state ~= 0 and door.state ~= false and door.state ~= 1 and door.state ~= true) then
                if not lockWarnings[group] then print(('MLO door %s: ox_doorlock state unavailable; keeping locked'):format(group)); lockWarnings[group] = true end
                return true
            end
            lockWarnings[group] = nil
            if door.state == 1 or door.state == true then return true end
        end
    end
    return false
end
local function ratio(s)
    local t = s.duration == 0 and 1 or math.min(1, math.max(0, (GetGameTimer() - s.started) / s.duration))
    return s.from + (s.target - s.from) * t
end
local function snapshot(group)
    local s = states[group]
    return { from = ratio(s), target = s.target, duration = math.max(0, s.duration - (GetGameTimer() - s.started)), revision = s.revision }
end
local function setOpen(group, open)
    if type(group) ~= 'string' or type(open) ~= 'boolean' or not states[group] then return false end
    if open and isLocked(group) then return false end
    local s, target = states[group], open and 1 or 0
    if s.target == target then return true end
    local current, fullDuration = ratio(s), 0
    for _, d in ipairs(groups[group]) do fullDuration = math.max(fullDuration, d.travel / d.speed * 1000) end
    states[group] = { from = current, target = target, duration = math.abs(target - current) * fullDuration, started = GetGameTimer(), revision = s.revision + 1 }
    TriggerClientEvent(event .. 'state', -1, group, snapshot(group))
    return true
end
exports('SetDoorOpen', setOpen)
exports('GetDoorOpen', function(group) return states[group] and states[group].target == 1 end)
exports('SetDoorLocked', function(group, locked)
    if type(group) ~= 'string' or not states[group] or type(locked) ~= 'boolean' then return false end
    locks[group] = locked
    if locked then setOpen(group, false) end
    return true
end)
exports('GetDoorLocked', function(group) return isLocked(group) end)
RegisterNetEvent(event .. 'request', function(group, action)
    local player, now = source, GetGameTimer()
    if requests[player] and now - requests[player] < 300 then return end
    requests[player] = now
    if type(group) ~= 'string' or not groups[group] or not IsPlayerAceAllowed(player, 'mlo.doors') then return end
    if action ~= 'open' and action ~= 'close' and action ~= 'toggle' then return end
    local ped = GetPlayerPed(player)
    if ped == 0 then return end
    local pos, near = GetEntityCoords(ped), false
    for _, d in ipairs(groups[group]) do
        if (pos.x - d.x)^2 + (pos.y - d.y)^2 + (pos.z - d.z)^2 <= 64 then near = true; break end
    end
    if near then setOpen(group, action == 'open' or (action == 'toggle' and states[group].target == 0)) end
end)
RegisterNetEvent(event .. 'sync', function(token)
    local player, now = source, GetGameTimer()
    if type(token) ~= 'number' or token ~= token then return end
    if snapshots[player] and now - snapshots[player] < 1000 then return end
    snapshots[player] = now
    local result = {}
    for group in pairs(states) do result[group] = snapshot(group) end
    TriggerClientEvent(event .. 'snapshot', player, token, result)
end)
AddEventHandler('playerDropped', function() requests[source] = nil; snapshots[source] = nil end)

-- One authority decides proximity. Clients cannot submit an auto-open position,
-- claim that the area is clear, or bypass the lock provider.
CreateThread(function()
    while true do
        local positions = {}
        if hasAuto then
            for _, player in ipairs(GetPlayers()) do
                local ped = GetPlayerPed(player)
                if ped ~= 0 and DoesEntityExist(ped) then positions[#positions + 1] = GetEntityCoords(ped) end
            end
            for _, vehicle in ipairs(GetAllVehicles()) do
                if DoesEntityExist(vehicle) then positions[#positions + 1] = GetEntityCoords(vehicle) end
            end
        end
        local now = GetGameTimer()
        for group, leaves in pairs(groups) do
            if isLocked(group) then
                lastNear[group] = nil
                setOpen(group, false)
            elseif leaves[1].autoOpen then
                local nearby = false
                for _, d in ipairs(leaves) do
                    local radius = (d.autoDistance or 6) + (states[group].target == 1 and 2 or 0)
                    for _, pos in ipairs(positions) do
                        if (pos.x - (d.triggerX or d.x))^2 + (pos.y - (d.triggerY or d.y))^2 + (pos.z - (d.triggerZ or d.z))^2 <= radius * radius then nearby = true; break end
                    end
                    if nearby then break end
                end
                if nearby then
                    lastNear[group] = now
                    setOpen(group, true)
                else
                    lastNear[group] = lastNear[group] or now
                    if now - lastNear[group] >= (leaves[1].closeDelay or 3) * 1000 then setOpen(group, false) end
                end
            end
        end
        Wait(500)
    end
end)
