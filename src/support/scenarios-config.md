Scenarios Configuration
=======================

Purpose
-------
This file documents the `scenarios-config.json` file used by the controller to select actions based on boolean trigger expressions.

Format
------
The config is a JSON array of scenario objects. Each object has:

- `id`: unique identifier string
- `label`: human-friendly name
- `description`: optional description
- `trigger`: a boolean expression evaluated against current state
- `actionId`: an action `id` from `actions-config.json` to execute when the trigger is true
- `enabled`: optional boolean (default true)

Trigger expression variables
----------------------------
- `uvi`: numeric (or null) — current UV index
- `clouds`: numeric (or null) — cloud coverage percentage
- `forecast_uv_median_today`: numeric (or null) — median UV forecast for today (daytime hours)
- `forecast_uv_median_tomorrow`: numeric (or null) — median UV forecast for tomorrow (daytime hours)
- `battery_cap`: numeric (or null) — battery capacity percentage (0-100)
- `isDay`: boolean — true during daytime (between sunrise/sunset)
- `isNight`: boolean — true during nighttime
 `power_total`: numeric (or null) — sum of all power readings in kW (House + Photovoltaics + Battery + Plug + Grid)
Examples
`"uvi >= 3 && (power_total === null || power_total < 50) && isDay"` — turn on plug during daytime when UVI is strong and total power is low.

`"isNight && (power_total !== null && battery_cap < 50)"` — during night, if battery capacity is below 50%, take action.

`"forecast_uv_median_today && battery_cap > 40 && isDay"` — morning operation: turn on plug when median UV forecast is available, battery is above 40%, and it's daytime.

Security note
-------------
Trigger expressions are evaluated using a Function constructor with a limited set of variables. Only use trusted configs.
