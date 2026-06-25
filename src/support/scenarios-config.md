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
- `uvi`: numeric (or null)
- `clouds`: numeric (or null)
- `isDay`: boolean
- `isNight`: boolean
- `power_total`: numeric sum of numeric power readings (or null)
- `power`: object mapping power metric keys to raw string values

Examples
--------
`"uvi >= 3 && (power_total === null || power_total < 500) && isDay"` — turn on plug during daytime when UVI is strong and total power is low.

`"isNight && (power_total !== null && power_total > 200)"` — during night, if power production (or reported metric) is above threshold, take action.

Security note
-------------
Trigger expressions are evaluated using a Function constructor with a limited set of variables. Only use trusted configs.
